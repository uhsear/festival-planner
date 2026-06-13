#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# backup-offsite-git.sh
#
# Off-site, encrypted, version-controlled DB backups for Festie prod.
#
# WHAT IT DOES
#   1. Finds the NEWEST *.dump in $BACKUP_DIR (default ~/backups/festie).
#   2. Encrypts it with GPG symmetric AES256 using $BACKUP_GPG_PASSPHRASE
#      (read from ../.env). The passphrase NEVER leaves the server.
#   3. Pushes the encrypted blob to a PRIVATE GitHub repo (uhsear/festie-backups)
#      over SSH using a dedicated, write-only deploy key. The repo is the
#      off-site store -- no third-party cloud account required.
#   4. Prunes the repo to the most recent 14 encrypted dumps (older ones are
#      git-removed and committed) to bound repo growth.
#
# This is a SUPPLEMENT to the on-host 6-hourly pg backups (backup-pg.sh) and the
# rsync-based scripts/backup-offsite.sh (which needs OFFSITE_TARGET). This
# git path is the working off-site copy.
#
# CONFIG (in ../.env):
#   BACKUP_GPG_PASSPHRASE   strong random passphrase (generated, stored once)
#   BACKUP_DIR              optional, default $HOME/backups/festie
#
# Deploy key:  /home/asir/.ssh/festie_backups_deploy   (ed25519, no passphrase)
# Local clone: /home/asir/festie-backups-git           (shallow)
# Repo:        git@github.com:uhsear/festie-backups.git
#
# -----------------------------------------------------------------------------
# RESTORE PROCEDURE
# -----------------------------------------------------------------------------
#   On any trusted machine with git, gpg and Postgres client tools:
#
#   1. Clone the private backups repo (needs read access to uhsear/festie-backups):
#        git clone git@github.com:uhsear/festie-backups.git
#        cd festie-backups/dumps
#
#   2. Pick the dump you want (filenames carry the original timestamp), then
#      decrypt it. You will be prompted for BACKUP_GPG_PASSPHRASE
#      (stored in prod's festival-planner/.env, key BACKUP_GPG_PASSPHRASE):
#        gpg --output restored.dump --decrypt fp_YYYYMMDD_HHMMSS.dump.gpg
#      (non-interactive: gpg --batch --passphrase "$BACKUP_GPG_PASSPHRASE" \
#                            --output restored.dump --decrypt FILE.gpg)
#
#   3. Restore into a Postgres database with pg_restore. Example into a fresh DB:
#        createdb festie_restore
#        pg_restore --no-owner --no-privileges -d festie_restore restored.dump
#      Or restore in place (DESTRUCTIVE -- coordinate, this is prod data):
#        pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" restored.dump
#
#   4. Verify: psql -d festie_restore -c '\dt' and spot-check row counts.
#
#   The dumps are custom-format (pg_dump -Fc), so pg_restore --list works to
#   inspect contents before restoring:
#        pg_restore --list restored.dump | head
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../.env" 2>/dev/null || true

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/festie}"
LOG_FILE="$BACKUP_DIR/offsite-git.log"
DEPLOY_KEY="${BACKUP_DEPLOY_KEY:-$HOME/.ssh/festie_backups_deploy}"
REPO_SSH="git@github.com:uhsear/festie-backups.git"
CLONE_DIR="${BACKUP_GIT_CLONE:-$HOME/festie-backups-git}"
DUMPS_SUBDIR="dumps"
KEEP=14

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

if [ -z "${BACKUP_GPG_PASSPHRASE:-}" ]; then
  log "ERROR: BACKUP_GPG_PASSPHRASE not set in .env -- aborting (no off-site backup made)."
  exit 1
fi

# 1. Newest dump (exclude already-encrypted, just in case)
NEWEST="$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1 || true)"
if [ -z "$NEWEST" ]; then
  log "ERROR: no *.dump found in $BACKUP_DIR -- nothing to push."
  exit 1
fi
BASENAME="$(basename "$NEWEST")"
ENC_NAME="${BASENAME}.gpg"
log "Selected newest dump: $BASENAME"

# 2. Clone on first run (shallow), else refresh
if [ ! -d "$CLONE_DIR/.git" ]; then
  rm -rf "$CLONE_DIR"
  if git clone --depth 1 "$REPO_SSH" "$CLONE_DIR" >>"$LOG_FILE" 2>&1; then
    log "Cloned $REPO_SSH (shallow)."
  else
    # Empty repo: clone fails; init instead
    log "Clone failed (likely empty repo) -- initializing fresh."
    mkdir -p "$CLONE_DIR"
    git -C "$CLONE_DIR" init -q
    git -C "$CLONE_DIR" remote add origin "$REPO_SSH"
    git -C "$CLONE_DIR" checkout -q -b main 2>/dev/null || true
  fi
fi

cd "$CLONE_DIR"
git config user.email "backup-bot@festie.us"
git config user.name "festie-backup-bot"
git fetch --depth 1 origin >>"$LOG_FILE" 2>&1 || true
git checkout -q main 2>/dev/null || git checkout -q -b main
git reset -q --hard origin/main 2>/dev/null || true

mkdir -p "$DUMPS_SUBDIR"

# 3. Encrypt newest dump (AES256 symmetric) into the repo's dumps dir
if [ -f "$DUMPS_SUBDIR/$ENC_NAME" ]; then
  log "Already pushed $ENC_NAME -- skipping re-encrypt; running prune only."
else
  if gpg --batch --yes --quiet \
        --symmetric --cipher-algo AES256 \
        --passphrase "$BACKUP_GPG_PASSPHRASE" \
        --output "$DUMPS_SUBDIR/$ENC_NAME" \
        "$NEWEST"; then
    log "Encrypted -> $DUMPS_SUBDIR/$ENC_NAME"
    git add "$DUMPS_SUBDIR/$ENC_NAME"
  else
    log "ERROR: gpg encryption failed for $BASENAME -- aborting."
    exit 1
  fi
fi

# 4. Prune to last $KEEP encrypted dumps
mapfile -t ALL < <(ls -1 "$DUMPS_SUBDIR"/*.gpg 2>/dev/null | sort)
COUNT=${#ALL[@]}
if [ "$COUNT" -gt "$KEEP" ]; then
  REMOVE=$((COUNT - KEEP))
  for ((i=0; i<REMOVE; i++)); do
    git rm -q --ignore-unmatch "${ALL[$i]}" || rm -f "${ALL[$i]}"
    log "Pruned old dump: $(basename "${ALL[$i]}")"
  done
fi

# Commit + push if anything changed
if ! git diff --cached --quiet || ! git diff --quiet; then
  git add -A "$DUMPS_SUBDIR"
  git commit -q -m "backup: $BASENAME ($(date '+%Y-%m-%d %H:%M:%S'))" >>"$LOG_FILE" 2>&1 || true
  if git push -q origin main >>"$LOG_FILE" 2>&1; then
    log "Pushed to $REPO_SSH (main). Repo now holds $(ls -1 "$DUMPS_SUBDIR"/*.gpg 2>/dev/null | wc -l) dumps."
  else
    log "ERROR: git push failed -- check deploy key / network."
    exit 1
  fi
else
  log "No changes to push."
fi

log "Off-site git backup completed."

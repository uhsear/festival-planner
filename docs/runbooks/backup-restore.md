# Backup & Restore Runbook

Festie prod has three layers of database backup:

| Layer | Script | Schedule | Location | Retention |
|-------|--------|----------|----------|-----------|
| On-host dumps | `scripts/backup-pg.sh` | every 6h | `~/backups/festie/*.dump` | rolling local |
| Off-site rsync (optional) | `scripts/backup-offsite.sh` | 01:00 daily | `$OFFSITE_TARGET` (unset by default) | mirror |
| **Off-site encrypted git** | `scripts/backup-offsite-git.sh` | **01:30 daily** | private repo `uhsear/festie-backups` | **last 14** |

The **off-site encrypted git** path is the active, no-extra-cloud-account offsite
store. Dumps are `pg_dump -Fc` (custom format), GPG-symmetric-encrypted with
AES256, and pushed to a private GitHub repo via a write-only ed25519 deploy key.

## Where the secrets live

- **GPG passphrase**: `BACKUP_GPG_PASSPHRASE` in prod's
  `/home/asir/festival-planner/.env`. This is the ONLY copy — back it up to a
  password manager out-of-band, or encrypted dumps are unrecoverable.
- **Deploy key (push)**: `/home/asir/.ssh/festie_backups_deploy` on prod;
  registered as a read-write deploy key on `uhsear/festie-backups`.
- **Repo read access**: any account with read on `uhsear/festie-backups`
  (e.g. `uhsear` via `gh`) can clone to restore.

## Restore procedure

On any trusted machine with `git`, `gpg`, and Postgres client tools:

1. **Clone the private backups repo** (needs read access):
   ```bash
   git clone git@github.com:uhsear/festie-backups.git
   cd festie-backups/dumps
   ls -t            # newest encrypted dump first; filename carries timestamp
   ```

2. **Decrypt** the chosen dump (you'll be prompted for the passphrase):
   ```bash
   gpg --output restored.dump --decrypt fp_YYYYMMDD_HHMMSS.dump.gpg
   ```
   Non-interactive:
   ```bash
   gpg --batch --passphrase "$BACKUP_GPG_PASSPHRASE" \
       --output restored.dump --decrypt fp_YYYYMMDD_HHMMSS.dump.gpg
   ```

3. **Inspect before restoring** (optional, custom-format dumps support this):
   ```bash
   pg_restore --list restored.dump | head
   ```

4. **Restore** into a fresh database (safe — no prod impact):
   ```bash
   createdb festie_restore
   pg_restore --no-owner --no-privileges -d festie_restore restored.dump
   psql -d festie_restore -c '\dt'      # verify
   ```
   Or, to restore in place (**DESTRUCTIVE** — overwrites prod data, coordinate first):
   ```bash
   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" restored.dump
   ```

## Operations

- **Logs**: `~/backups/festie/offsite-git.log` on prod.
- **Manual run**: `~/festival-planner/scripts/backup-offsite-git.sh`.
- **Local clone cache**: `~/festie-backups-git` (shallow; safe to delete, it
  re-clones on next run).
- **Verify weekly**: `scripts/backup-verify.sh` already runs `pg_restore --list`
  on the newest on-host dump (cron Sun 04:00).

## Recovery if the passphrase is lost

There is no recovery path. The encrypted dumps cannot be decrypted without
`BACKUP_GPG_PASSPHRASE`. Keep an out-of-band copy in a password manager.

/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Offline/Sync Module
 * Manages localStorage snapshots, profile sync queue, and offline state.
 */
import { S, OFFLINE_SNAPSHOT_KEY, LEGACY_OFFLINE_KEYS, OFFLINE_SYNC_KEY } from './state.js?v=1776342458439';

// ── Late-bound deps (set via initOffline) ─────────────────────
let api, toast, render;
let _syncInFlight = false;
let _profileSyncTimer = null;

export function initOffline(deps) {
  api = deps.api;
  toast = deps.toast;
  render = deps.render;
}

// ── localStorage helpers ──────────────────────────────────────
export function readStoredJSON(key, fallback = null) { try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (_e) { return fallback; } }
export function writeStoredJSON(key, value) { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* quota exceeded */ } }
export function removeStoredValue(key) { try { window.localStorage.removeItem(key); } catch (_e) { /* */ } }
export function clearLegacyOfflineData() { LEGACY_OFFLINE_KEYS.forEach(removeStoredValue); }

// ── Snapshot management ───────────────────────────────────────
function mutateOfflineSnapshot(mutator) { clearLegacyOfflineData(); const snapshot = readStoredJSON(OFFLINE_SNAPSHOT_KEY, null); if (!snapshot) return; const nextSnapshot = mutator(snapshot) || snapshot; writeStoredJSON(OFFLINE_SNAPSHOT_KEY, nextSnapshot); }
export function pruneOfflineSnapshotFestivals(snapshot) { const validFestivalIds = new Set((snapshot.festivals || []).map(festival => festival.id)); Object.keys(snapshot.byFestival || {}).forEach(festivalId => { if (!validFestivalIds.has(festivalId)) delete snapshot.byFestival[festivalId]; }); if (snapshot.currentFestivalId && !validFestivalIds.has(snapshot.currentFestivalId)) snapshot.currentFestivalId = snapshot.festivals?.[0]?.id || Object.keys(snapshot.byFestival || {})[0] || null; return snapshot; }

export function sanitizeOfflineProfile(profile = S.currentProfile) { if (!profile) return null; return { id: profile.id, festivalId: profile.festivalId, userId: profile.userId, name: profile.name, avatarUrl: profile.avatarUrl || S.user?.avatarUrl || null, picks: profile.picks || {}, notes: profile.notes || {}, reminders: {}, createdAt: profile.createdAt, updatedAt: profile.updatedAt }; }

// Persist whatever we know so the next boot can render instantly even
// offline. Previously gated on a logged-in S.user, which meant guests
// browsing the public festival schedule got a blank page after closing
// the browser and reopening offline. Now we always snapshot festivals +
// current-festival structure; user info is included only when logged in.
export function persistOfflineSnapshot() { clearLegacyOfflineData(); const snapshot = readStoredJSON(OFFLINE_SNAPSHOT_KEY, { version: 2, byFestival: {} }) || { version: 2, byFestival: {} }; if (S.user) { snapshot.user = { id: S.user.id, username: S.user.username, avatarUrl: S.user.avatarUrl || null }; } else { delete snapshot.user; } snapshot.festivals = S.festivals || []; snapshot.currentFestivalId = S.currentFestival?.id || snapshot.currentFestivalId || null; snapshot.view = S.view; snapshot.selectedDay = S.selectedDay; snapshot.byFestival = snapshot.byFestival || {}; if (S.currentFestival?.id) { snapshot.byFestival[S.currentFestival.id] = { festival: S.currentFestival, currentProfile: sanitizeOfflineProfile(), allProfiles: (S.allProfiles || []).map(p => sanitizeOfflineProfile(p)).filter(Boolean), savedAt: new Date().toISOString() }; } writeStoredJSON(OFFLINE_SNAPSHOT_KEY, pruneOfflineSnapshotFestivals(snapshot)); }

export function clearOfflineData() { clearLegacyOfflineData(); removeStoredValue(OFFLINE_SNAPSHOT_KEY); removeStoredValue(OFFLINE_SYNC_KEY); S.pendingSync = false; S.offlineMode = false; }

// Rehydrate the offline snapshot. Logged-in users restore their profile
// state; guests restore just the public festival structure so the cards
// view has something to render even on a cold offline boot.
export function hydrateOfflineSnapshot(targetFestivalId = null) { clearLegacyOfflineData(); const snapshot = readStoredJSON(OFFLINE_SNAPSHOT_KEY, null); if (!snapshot || typeof snapshot !== 'object') return false; if (!Array.isArray(snapshot.festivals)) snapshot.festivals = []; if (!snapshot.byFestival || typeof snapshot.byFestival !== 'object') snapshot.byFestival = {}; const festivalId = targetFestivalId || snapshot.currentFestivalId || snapshot.festivals?.[0]?.id; const festivalSnapshot = festivalId ? snapshot.byFestival?.[festivalId] : null; if (snapshot.user && typeof snapshot.user === 'object' && snapshot.user.id && snapshot.user.username) { S.user = snapshot.user; } S.festivals = snapshot.festivals || []; if (festivalSnapshot && typeof festivalSnapshot === 'object') { S.currentFestival = festivalSnapshot.festival || null; S.activeStages = S.currentFestival?.stages?.map(stage => stage.id) || []; S.currentProfile = festivalSnapshot.currentProfile || null; S.allProfiles = festivalSnapshot.allProfiles || (S.currentProfile ? [S.currentProfile] : []); S.selectedDay = Math.min(snapshot.selectedDay || 0, Math.max(0, (festivalSnapshot.festival?.days?.length || 1) - 1)); } S.offlineMode = true; updatePendingSyncState(); return S.festivals.length > 0 || !!S.currentFestival; }

// ── Sync queue ────────────────────────────────────────────────
export function updatePendingSyncState() { const pending = readStoredJSON(OFFLINE_SYNC_KEY, {}); S.pendingSync = Object.keys(pending || {}).length > 0; }
function buildProfileSyncPayload(profile = S.currentProfile) { return { picks: profile?.picks || {}, notes: profile?.notes || {} }; }
export function queueCurrentProfileSync() { if (!S.currentProfile) return; const pending = readStoredJSON(OFFLINE_SYNC_KEY, {}) || {}; pending[S.currentProfile.id] = { profileId: S.currentProfile.id, festivalId: S.currentFestival?.id || null, payload: buildProfileSyncPayload() }; writeStoredJSON(OFFLINE_SYNC_KEY, pending); S.pendingSync = true; }
export function clearPendingProfileSync(profileId) { const pending = readStoredJSON(OFFLINE_SYNC_KEY, {}) || {}; delete pending[profileId]; if (Object.keys(pending).length === 0) removeStoredValue(OFFLINE_SYNC_KEY); else writeStoredJSON(OFFLINE_SYNC_KEY, pending); updatePendingSyncState(); }
function clearPendingProfileSyncForFestival(festivalId) { const pending = readStoredJSON(OFFLINE_SYNC_KEY, {}) || {}; let changed = false; Object.entries(pending).forEach(([_profileId, entry]) => { if (entry?.festivalId === festivalId) { delete pending[_profileId]; changed = true; } }); if (!changed) return; if (Object.keys(pending).length === 0) removeStoredValue(OFFLINE_SYNC_KEY); else writeStoredJSON(OFFLINE_SYNC_KEY, pending); updatePendingSyncState(); }

// ── Festival offline management ───────────────────────────────
function clearFestivalOfflineProfile(festivalId) { mutateOfflineSnapshot(snapshot => { const festivalSnapshot = snapshot.byFestival?.[festivalId]; if (festivalSnapshot) delete festivalSnapshot.currentProfile; return pruneOfflineSnapshotFestivals(snapshot); }); }
function removeFestivalOfflineSnapshot(festivalId) { mutateOfflineSnapshot(snapshot => { if (snapshot.byFestival) delete snapshot.byFestival[festivalId]; snapshot.festivals = (snapshot.festivals || []).filter(festival => festival.id !== festivalId); return pruneOfflineSnapshotFestivals(snapshot); }); }

export function dropFestivalMembership(festivalId) { if (!festivalId) return; if (S.currentProfile?.festivalId === festivalId) clearPendingProfileSync(S.currentProfile.id); clearPendingProfileSyncForFestival(festivalId); clearFestivalOfflineProfile(festivalId); if (S.currentFestival?.id === festivalId) { S.currentProfile = null; S.allProfiles = []; S.detailSet = null; S.onlineUsers = []; S.picksDay = null; S.searchQuery = ''; S.crews = []; S.activeCrew = null; S.crewOverlap = {}; S.crewMembers = []; S.crewLoading = false; if (!['cards', 'timeline'].includes(S.view)) S.view = 'cards'; } }

export function removeFestivalFromClientState(festivalId) { if (!festivalId) return; dropFestivalMembership(festivalId); S.festivals = S.festivals.filter(festival => festival.id !== festivalId); removeFestivalOfflineSnapshot(festivalId); if (S.currentFestival?.id === festivalId) { S.currentFestival = null; S.activeStages = []; S.searchQuery = ''; S.selectedDay = 0; } }

// ── Profile merge ─────────────────────────────────────────────
export function mergeCurrentProfile(profile) { if (!profile) return; S.currentProfile = { ...(S.currentProfile || {}), ...profile }; const idx = S.allProfiles.findIndex(p => p.id === profile.id); if (idx >= 0) S.allProfiles[idx] = { ...S.allProfiles[idx], ...profile }; else S.allProfiles.push(profile); persistOfflineSnapshot(); }

function isDiscardableSyncError(message = '') { return /Please log in|Profile not found|Not your profile|Pick references an unknown set|Note references an unknown set|Live status references an unknown stage/.test(message); }


// ── Last-Write-Wins Conflict Resolution ──────────────────────
export function resolveOfflineConflicts(localProfile, serverProfile) {
  if (!localProfile || !serverProfile) return localProfile || serverProfile;
  const localTime = new Date(localProfile.updatedAt || 0).getTime();
  const serverTime = new Date(serverProfile.updatedAt || 0).getTime();

  // Picks: merge using LWW per set — local picks are authoritative (client-wins for personal data)
  const mergedPicks = { ...(serverProfile.picks || {}) };
  const localPicks = localProfile.picks || {};
  for (const [setId, priority] of Object.entries(localPicks)) {
    mergedPicks[setId] = priority; // client-wins for picks
  }
  // Remove picks the user explicitly deleted locally
  for (const setId of Object.keys(serverProfile.picks || {})) {
    if (localPicks[setId] === undefined && localProfile._deletedPicks?.[setId]) {
      delete mergedPicks[setId];
    }
  }

  // Notes: merge using LWW per set — client-wins
  const mergedNotes = { ...(serverProfile.notes || {}) };
  const localNotes = localProfile.notes || {};
  for (const [setId, note] of Object.entries(localNotes)) {
    mergedNotes[setId] = note;
  }

  return {
    ...serverProfile,
    picks: mergedPicks,
    notes: mergedNotes,
    updatedAt: new Date(Math.max(localTime, serverTime)).toISOString(),
  };
}

// Track deleted picks for conflict resolution
export function trackPickDeletion(setId) {
  const pending = readStoredJSON(OFFLINE_SYNC_KEY, {}) || {};
  const currentEntry = pending[S.currentProfile?.id];
  if (currentEntry) {
    currentEntry._deletedPicks = currentEntry._deletedPicks || {};
    currentEntry._deletedPicks[setId] = Date.now();
    writeStoredJSON(OFFLINE_SYNC_KEY, pending);
  }
}

// ── Sync engine ───────────────────────────────────────────────
export async function syncCurrentProfile() { if (_syncInFlight) return; if (!S.currentProfile) return; if (!navigator.onLine) { S.offlineMode = true; queueCurrentProfileSync(); persistOfflineSnapshot(); render(); return; } _syncInFlight = true; try { let result = await api('/profiles/' + S.currentProfile.id, { method: 'PUT', body: buildProfileSyncPayload() });
    // Apply LWW conflict resolution if server returned different data
    if (S.offlineMode) result = resolveOfflineConflicts(S.currentProfile, result); mergeCurrentProfile(result); clearPendingProfileSync(S.currentProfile.id); const wasOffline = S.offlineMode; S.offlineMode = false; if (wasOffline) render(); } catch (e) { if (isDiscardableSyncError(e.message || '')) { clearPendingProfileSync(S.currentProfile.id); toast(e.message || 'Festival profile changed and some offline edits were dropped', 'error'); } else { queueCurrentProfileSync(); persistOfflineSnapshot(); S.offlineMode = true; toast('Saved offline. Changes will sync when connection returns.', 'info'); } render(); } finally { _syncInFlight = false; } }

export function scheduleProfileSync(delay = 350) { clearTimeout(_profileSyncTimer); _profileSyncTimer = setTimeout(() => { syncCurrentProfile().catch(() => {}); }, delay); }

export function clearProfileSyncTimer() { clearTimeout(_profileSyncTimer); }

export async function flushPendingProfileSync({ silent = false } = {}) { const pending = readStoredJSON(OFFLINE_SYNC_KEY, {}) || {}; const entries = Object.values(pending); if (entries.length === 0 || !navigator.onLine) return; let syncedCount = 0; for (const entry of entries) { try { const result = await api('/profiles/' + entry.profileId, { method: 'PUT', body: entry.payload }); if (S.currentProfile?.id === entry.profileId) mergeCurrentProfile(result); clearPendingProfileSync(entry.profileId); syncedCount += 1; } catch (e) { if (isDiscardableSyncError(e.message || '')) clearPendingProfileSync(entry.profileId); } } if (syncedCount > 0 && !silent) toast('Offline changes synced', 'success'); updatePendingSyncState(); }

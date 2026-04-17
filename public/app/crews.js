/**
 * Crew API module — all crew CRUD operations + crew-scoped queries
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */

import { S } from './state.js?v=1776342458439';
import { getAvatarColor, getInitials } from './helpers.js?v=1776342458439';

let _api, _toast, _render, _socket, _getOtherPicks;
let _crewSelectGen = 0;
let _crewPicksCache = new Map(), _crewPicksOverlapRef = null, _crewPicksUserRef = null;

/**
 * Initialize the crews module with dependencies.
 * Must be called once before using any crew functions.
 * @param {Object} deps - { api, toast, render, socket, getOtherPicks }
 */
export function initCrews(deps) {
  _api = deps.api;
  _toast = deps.toast;
  _render = deps.render;
  _socket = deps.socket;
  _getOtherPicks = deps.getOtherPicks;
}

export async function loadMyCrews(festivalId) {
  if (!festivalId || !S.user) return;
  try {
    S.crews = await _api('/crews?festivalId=' + encodeURIComponent(festivalId));
  } catch (e) {
    if (!navigator.onLine && S.crews.length > 0) { /* keep cached */ }
    else { S.crews = []; }
  }
}

export async function loadCrewDetails(crewId) {
  if (!crewId) return null;
  try {
    const data = await _api('/crews/' + crewId);
    S.crewMembers = data.members || [];
    return data;
  } catch (e) { return null; }
}

export async function loadCrewOverlap(crewId) {
  if (!crewId) return;
  try {
    const data = await _api('/crews/' + crewId + '/overlap');
    const raw = data?.overlap;
    if (!raw || typeof raw !== 'object') { S.crewOverlap = {}; return; }
    const safe = {};
    for (const [setId, picks] of Object.entries(raw)) {
      if (typeof setId === 'string' && Array.isArray(picks))
        safe[setId] = picks.filter(p => p && typeof p.userId === 'string' && typeof p.username === 'string' && typeof p.priority === 'string');
    }
    S.crewOverlap = safe;
  } catch (e) { S.crewOverlap = {}; }
}

export async function selectCrew(crew) {
  if (crew && crew.id === S.activeCrew?.id) return;
  const gen = ++_crewSelectGen;
  if (S.activeCrew && _socket.connected) { _socket.emit('leave:crew', { crewId: S.activeCrew.id }); }
  if (!crew) { S.activeCrew = null; S.crewOverlap = {}; S.crewMembers = []; _render(); return; }
  S.crewLoading = true; _render();
  await Promise.all([loadCrewDetails(crew.id), loadCrewOverlap(crew.id)]);
  if (gen !== _crewSelectGen) return;
  S.activeCrew = crew;
  if (_socket.connected) { _socket.emit('join:crew', { crewId: crew.id }, () => {}); }
  S.crewLoading = false; _render();
}

export async function createCrew(name) {
  if (!S.currentFestival || !name?.trim()) return;
  try {
    const result = await _api('/crews', { method: 'POST', body: { name: name.trim(), festivalId: S.currentFestival.id } });
    await loadMyCrews(S.currentFestival.id);
    await selectCrew(result);
    _toast('Crew created!', 'success');
  } catch (e) { _toast(e.message || 'Couldn\u2019t create crew. Try again.', 'error'); }
}

export async function joinCrewByCode(code) {
  if (!code?.trim()) return;
  try {
    const result = await _api('/crews/join', { method: 'POST', body: { inviteCode: code.trim() } });
    await loadMyCrews(S.currentFestival.id);
    await selectCrew(result);
    _toast(`Joined ${result.name}!`, 'success');
  } catch (e) { _toast(e.message || 'Couldn\u2019t join crew. Check the invite code.', 'error'); }
}

export async function leaveCrew(crewId) {
  if (!crewId) return;
  try {
    await _api('/crews/' + crewId + '/leave', { method: 'DELETE' });
    if (S.activeCrew?.id === crewId) { S.activeCrew = null; S.crewOverlap = {}; S.crewMembers = []; }
    await loadMyCrews(S.currentFestival.id);
    _toast('Left crew', 'info'); _render();
  } catch (e) { _toast(e.message || 'Couldn\u2019t leave crew. Try again.', 'error'); }
}

export async function kickCrewMember(crewId, userId) {
  if (!crewId || !userId) return;
  try {
    await _api('/crews/' + crewId + '/members/' + userId, { method: 'DELETE' });
    await loadCrewDetails(crewId);
    _toast('Member removed', 'info'); _render();
  } catch (e) { _toast(e.message || 'Couldn\u2019t remove member. Try again.', 'error'); }
}

export async function transferCrewOwnership(crewId, targetUserId) {
  if (!crewId || !targetUserId) return;
  try {
    const result = await _api('/crews/' + crewId + '/transfer', { method: 'PUT', body: { userId: targetUserId } });
    S.activeCrew = result; S.crewMembers = result.members || [];
    await loadMyCrews(S.currentFestival.id);
    _toast('Ownership transferred', 'success'); _render();
  } catch (e) { _toast(e.message || 'Couldn\u2019t transfer ownership. Try again.', 'error'); }
}

export async function regenerateInviteCode(crewId) {
  if (!crewId) return;
  try {
    const result = await _api('/crews/' + crewId + '/invite', { method: 'POST' });
    if (S.activeCrew?.id === crewId) S.activeCrew = { ...S.activeCrew, inviteCode: result.inviteCode };
    const idx = S.crews.findIndex(c => c.id === crewId);
    if (idx >= 0) S.crews[idx] = { ...S.crews[idx], inviteCode: result.inviteCode };
    _toast('New invite code generated', 'success'); _render();
  } catch (e) { _toast(e.message || 'Couldn\u2019t regenerate code. Try again.', 'error'); }
}

export async function deleteCrew(crewId) {
  if (!crewId) return;
  const crewName = S.activeCrew?.name || 'crew';
  S.activeCrew = null; S.crewOverlap = {}; S.crewMembers = [];
  S.crews = S.crews.filter(c => c.id !== crewId); _render();
  // undoToast is still in app.js — call via _undoToast if wired, otherwise inline timeout
  setTimeout(async () => {
    try {
      await _api('/crews/' + crewId, { method: 'DELETE' });
      await loadMyCrews(S.currentFestival.id); _render();
    } catch (e) {
      _toast(e.message || 'Couldn\u2019t delete crew. Try again.', 'error');
      await loadMyCrews(S.currentFestival.id); _render();
    }
  }, 5000);
}

export async function updateCrewName(crewId, name) {
  if (!crewId || !name?.trim()) return;
  try {
    const result = await _api('/crews/' + crewId, { method: 'PUT', body: { name: name.trim() } });
    if (S.activeCrew?.id === crewId) S.activeCrew = { ...S.activeCrew, name: result.name };
    await loadMyCrews(S.currentFestival.id);
    _toast('Crew renamed', 'success'); _render();
  } catch (e) { _toast(e.message || 'Couldn\u2019t rename crew. Try again.', 'error'); }
}

export function getCrewScopedProfiles() {
  if (!S.activeCrew || S.crewMembers.length === 0) return S.allProfiles;
  const memberIds = new Set(S.crewMembers.map(m => m.userId));
  return S.allProfiles.filter(p => memberIds.has(p.userId));
}

export function getCrewScopedOtherPicks(setId) {
  if (!S.activeCrew || !S.crewOverlap[setId]) return _getOtherPicks(setId);
  if (_crewPicksOverlapRef !== S.crewOverlap || _crewPicksUserRef !== S.user?.id) {
    _crewPicksCache.clear();
    _crewPicksOverlapRef = S.crewOverlap;
    _crewPicksUserRef = S.user?.id;
  }
  if (_crewPicksCache.has(setId)) return _crewPicksCache.get(setId);
  const result = S.crewOverlap[setId]
    .filter(p => p.userId !== S.user?.id)
    .map(p => ({ name: p.username, avatarUrl: null, priority: p.priority, color: getAvatarColor(p.username), initials: getInitials(p.username) }));
  _crewPicksCache.set(setId, result);
  if (_crewPicksCache.size > 500) { const first = _crewPicksCache.keys().next().value; _crewPicksCache.delete(first); }
  return result;
}

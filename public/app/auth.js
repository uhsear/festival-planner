/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Auth Module
 * Handles login, registration, forgot-password, logout, avatar management.
 */
import { S, TRUSTED_MUTATION_HEADER, ALLOWED_AVATAR_TYPES, MAX_AVATAR_UPLOAD_BYTES } from './state.js?v=1776342458439';
import { $ } from './dom.js?v=1776342458439';

// ── Late-bound deps (set via initAuth) ────────────────────────
let api, toast, render, refreshRealtimeSession, loadFestivalsAndSelect, persistOfflineSnapshot, clearOfflineData, updateIdentityCollections, registerPushToken, unregisterPushToken, hydrateOfflineSnapshot;

export function initAuth(deps) {
  api = deps.api;
  toast = deps.toast;
  render = deps.render;
  refreshRealtimeSession = deps.refreshRealtimeSession;
  loadFestivalsAndSelect = deps.loadFestivalsAndSelect;
  persistOfflineSnapshot = deps.persistOfflineSnapshot;
  clearOfflineData = deps.clearOfflineData;
  updateIdentityCollections = deps.updateIdentityCollections;
  registerPushToken = deps.registerPushToken;
  unregisterPushToken = deps.unregisterPushToken;
  hydrateOfflineSnapshot = deps.hydrateOfflineSnapshot;
}

// ── Session check ─────────────────────────────────────────────
export function checkUserSession() {
  return api('/auth/verify', { method: 'POST' }).then(r => {
    S.user = r.user; S.userToken = null; S.offlineMode = false; S.isAdmin = (r.roles || []).includes('admin'); persistOfflineSnapshot(); return true;
  }).catch(async (e) => {
    if (e?.isNetworkError) return hydrateOfflineSnapshot();
    try { const r = await api('/auth/me'); if (r.user) { S.user = r.user; S.userToken = null; S.offlineMode = false; S.isAdmin = (r.roles || []).includes('admin'); persistOfflineSnapshot(); return true; } } catch (_) { /* fallthrough */ }
    clearOfflineData();
    return false;
  });
}

// ── Registration ──────────────────────────────────────────────
export async function doRegister() {
  const user = $('#authUsername')?.value?.trim(); const pass = $('#authPassword')?.value; const pass2 = $('#authPassword2')?.value; const tosBox = $('#authTos'); const errEl = $('#authError'); const btn = $('#authBtn');
  if (!user || !pass) { if (errEl) errEl.textContent = 'Please fill in all fields'; return; }
  if (pass !== pass2) { if (errEl) errEl.textContent = 'Passwords do not match'; return; }
  if (pass.length < 8) { if (errEl) errEl.textContent = 'Password must be at least 8 characters'; return; }
  if (!tosBox?.checked) { if (errEl) errEl.textContent = 'You must accept the Terms of Service'; return; }
  if (btn) { btn.textContent = 'Creating account...'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    const result = await fetch('/api/v1/auth/register', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [TRUSTED_MUTATION_HEADER]: '1' }, body: JSON.stringify({ username: user, password: pass, confirmPassword: pass2, email: ($('#authEmail')?.value?.trim()) || undefined, tosAccepted: true }) }).then(r => r.json().then(d => ({ ok: r.ok, data: d.data, error: d.error })));
    if (!result.ok) { if (errEl) errEl.textContent = result.error?.message || 'Couldn\u2019t register. Try again or use a different username.'; if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; btn.removeAttribute('aria-busy'); } return; }
    S.user = result.data.user; S.userToken = null; S.isAdmin = (result.data.roles || []).includes("admin"); refreshRealtimeSession();
    toast('Account created! Welcome, ' + S.user.username + '!', 'success');
    await loadFestivalsAndSelect(); persistOfflineSnapshot(); render();
    registerPushToken(api).catch(() => {});
  } catch (_e) { if (errEl) errEl.textContent = 'Couldn\u2019t reach the server. Check your connection.'; if (btn) { btn.textContent = 'Create Account'; btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

// ── Login ─────────────────────────────────────────────────────
export async function doLogin() {
  const user = $('#authUsername')?.value?.trim(); const pass = $('#authPassword')?.value; const errEl = $('#authError'); const btn = $('#authBtn');
  if (!user || !pass) { if (errEl) errEl.textContent = 'Please enter username and password'; return; }
  if (btn) { btn.textContent = 'Logging in...'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    const result = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [TRUSTED_MUTATION_HEADER]: '1' }, body: JSON.stringify({ username: user, password: pass }) }).then(r => r.json().then(d => ({ ok: r.ok, data: d.data, error: d.error })));
    if (!result.ok) { if (errEl) errEl.textContent = result.error?.message || 'Couldn\u2019t sign in. Check username and password.'; if (btn) { btn.textContent = 'Login'; btn.disabled = false; btn.removeAttribute('aria-busy'); } return; }
    S.user = result.data.user; S.userToken = null; S.isAdmin = (result.data.roles || []).includes("admin"); refreshRealtimeSession();
    toast('Welcome back, ' + S.user.username + '!', 'success');
    await loadFestivalsAndSelect(); persistOfflineSnapshot(); render();
    registerPushToken(api).catch(() => {});
  } catch (_e) { if (errEl) errEl.textContent = 'Couldn\u2019t reach the server. Check your connection.'; if (btn) { btn.textContent = 'Login'; btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

// ── Forgot password ───────────────────────────────────────────
export async function doForgotPassword() {
  const email = $('#authEmail')?.value?.trim(); const errEl = $('#authError'); const btn = $('#authBtn');
  if (!email) { if (errEl) errEl.textContent = 'Please enter your email address'; return; }
  if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try {
    const result = await fetch('/api/v1/auth/forgot-password', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', [TRUSTED_MUTATION_HEADER]: '1' }, body: JSON.stringify({ email }) }).then(r => r.json().then(d => ({ ok: r.ok, data: d.data, error: d.error })));
    if (!result.ok) { if (errEl) errEl.textContent = result.error?.message || 'Couldn\u2019t send reset link. Try again.'; if (btn) { btn.textContent = 'Send Reset Link'; btn.disabled = false; btn.removeAttribute('aria-busy'); } return; }
    toast('If an account with that email exists, a reset link has been sent', 'success');
    S.authMode = 'login'; render();
  } catch (_e) { if (errEl) errEl.textContent = 'Couldn\u2019t reach the server. Check your connection.'; if (btn) { btn.textContent = 'Send Reset Link'; btn.disabled = false; btn.removeAttribute('aria-busy'); } }
}

// ── Logout ────────────────────────────────────────────────────
export function doUserLogout() {
  unregisterPushToken(api).catch(() => {});
  api('/auth/logout', { method: 'POST' }).catch(() => {});
  S.user = null; S.userToken = null; S.currentProfile = null; S.currentFestival = null; S.isAdmin = false; S.authMode = 'login';
  S.allProfiles = []; S.activeStages = []; S.detailSet = null;
  S.onlineUsers = []; S.picksDay = null; S.searchQuery = ''; S.crews = []; S.activeCrew = null; S.crewOverlap = {}; S.crewMembers = []; S.crewLoading = false;
  clearOfflineData();
  refreshRealtimeSession();
  render(); toast('Logged out', 'info');
}

// ── Avatar management ─────────────────────────────────────────
export async function uploadAvatar(file) {
  if (!file) return;
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) { toast('Use a JPG, PNG, GIF, or WebP image', 'error'); return; }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) { toast('Avatar must be 5MB or smaller', 'error'); return; }
  const formData = new FormData(); formData.append('avatar', file, file.name || 'avatar');
  S.avatarBusy = true;
  try {
    const resp = await fetch('/api/v1/account/avatar', { method: 'POST', credentials: 'same-origin', headers: { [TRUSTED_MUTATION_HEADER]: '1' }, body: formData });
    const raw = await resp.json().catch(() => ({ data: null, error: { message: 'Couldn\u2019t upload. Try again with a smaller image.' } }));
    if (!resp.ok) throw new Error(raw.error?.message || 'Couldn\u2019t upload. Try again with a smaller image.');
    updateIdentityCollections(raw.data.user.username, raw.data.user.avatarUrl || null, S.currentProfile?.id || null);
    S.avatarBusy = false; render(); toast('Profile photo updated', 'success');
  } catch (e) { S.avatarBusy = false; toast(e.message || 'Couldn\u2019t upload. Try again with a smaller image.', 'error'); render(); }
}

export async function removeAvatar() {
  if (!S.user?.avatarUrl || S.avatarBusy) return;
  S.avatarBusy = true; render();
  try {
    const result = await api('/account/avatar', { method: 'DELETE' });
    updateIdentityCollections(result.user.username, result.user.avatarUrl || null, S.currentProfile?.id || null);
    S.avatarBusy = false; render(); toast('Profile photo removed', 'info');
  } catch (e) { S.avatarBusy = false; render(); toast(e.message || 'Couldn\u2019t remove photo. Try again.', 'error'); }
}

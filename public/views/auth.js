/**
 * Auth & Account Views — Festie
 *
 * Extracted from app.js: auth screen, change password, change email, install instructions.
 * Pattern: import shared modules directly, receive app.js functions via deps.
 */

import { S } from '../app/state.js?v=1776342458439';
import { $, h } from '../app/dom.js?v=1776342458439';

/**
 * renderAuthScreen(container, deps)
 * deps: { doLogin, doRegister, doForgotPassword, render }
 */
export function renderAuthScreen(container, deps) {
  const { doLogin, doRegister, doForgotPassword, render } = deps;
  const screen = h('div', { className: 'auth-screen', role: 'region', 'aria-label': 'Authentication' });
  screen.appendChild(h('div', { className: 'logo-big' }, 'FESTIE'));
  screen.appendChild(h('div', { className: 'tagline' }, 'Plan your sets. Sync with your crew.'));
  const tabs = h('div', { className: 'auth-tabs' });
  if (S.authMode === 'forgot') { tabs.appendChild(h('button', { className: 'auth-tab', onclick: () => { S.authMode = 'login'; render() } }, '\u2190 Back to Login')) } else { tabs.appendChild(h('button', { className: 'auth-tab' + (S.authMode === 'login' ? ' active' : ''), onclick: () => { S.authMode = 'login'; render() } }, 'Login')); tabs.appendChild(h('button', { className: 'auth-tab' + (S.authMode === 'register' ? ' active' : ''), onclick: () => { S.authMode = 'register'; render() } }, 'Create Account')) }
  screen.appendChild(tabs);
  const form = h('div', { className: 'auth-form' });
  const err = h('div', { className: 'auth-error', id: 'authError', role: 'alert', 'aria-live': 'assertive' }, '\u00A0'); form.appendChild(err);
  if (S.authMode !== 'forgot') { form.appendChild(h('label', { for: 'authUsername', className: 'sr-only' }, 'Username')); form.appendChild(h('input', { type: 'text', placeholder: 'Username', id: 'authUsername', autocomplete: 'username', maxlength: '30', 'aria-describedby': 'authError', onkeydown: (e) => { if (e.key === 'Enter') { const next = $('#authPassword'); if (next) next.focus() } } })) }
  if (S.authMode !== 'forgot') { form.appendChild(h('label', { for: 'authPassword', className: 'sr-only' }, 'Password')); form.appendChild(h('input', { type: 'password', placeholder: 'Password', id: 'authPassword', autocomplete: S.authMode === 'register' ? 'new-password' : 'current-password', 'aria-describedby': 'authError', onkeydown: (e) => { if (e.key === 'Enter') { if (S.authMode === 'register') { const next = $('#authPassword2'); if (next) next.focus() } else doLogin() } } })) };
  if (S.authMode === 'register') { form.appendChild(h('label', { for: 'authPassword2', className: 'sr-only' }, 'Confirm Password')); form.appendChild(h('input', { type: 'password', placeholder: 'Confirm Password', id: 'authPassword2', autocomplete: 'new-password', 'aria-describedby': 'authError', onkeydown: (e) => { if (e.key === 'Enter') { const next = $('#authEmail'); if (next) next.focus(); else doRegister() } } })); form.appendChild(h('label', { for: 'authEmail', className: 'sr-only' }, 'Email (optional)')); form.appendChild(h('input', { type: 'email', placeholder: 'Email (optional, for password reset)', id: 'authEmail', autocomplete: 'email', maxlength: '254', 'aria-describedby': 'authError', onkeydown: (e) => { if (e.key === 'Enter') doRegister() } })); const tosRow = h('label', { className: 'tos-checkbox' }); tosRow.style.cssText = 'display:flex !important;align-items:flex-start;gap:8px;margin:10px 0;font-size:13px;color:var(--text-secondary);cursor:pointer'; const tosCheck = h('input', { type: 'checkbox', id: 'authTos' }); tosCheck.style.cssText = 'width:18px !important;height:18px !important;min-width:18px;padding:0 !important;margin-top:2px;accent-color:var(--accent);appearance:checkbox !important;-webkit-appearance:checkbox !important;background:transparent !important;border:1px solid var(--text-secondary) !important;border-radius:3px'; tosRow.appendChild(tosCheck); const tosText = h('span', {}, h('span', {}, 'I agree to the '), h('a', { href: '/terms.html', target: '_blank', style: 'color:var(--accent)' }, 'Terms of Service'), h('span', {}, ' and '), h('a', { href: '/privacy.html', target: '_blank', style: 'color:var(--accent)' }, 'Privacy Policy')); tosRow.appendChild(tosText); form.appendChild(tosRow) }
  if (S.authMode === 'forgot') { form.appendChild(h('label', { for: 'authEmail', className: 'sr-only' }, 'Email')); form.appendChild(h('input', { type: 'email', placeholder: 'Enter your email address', id: 'authEmail', autocomplete: 'email', maxlength: '254', 'aria-describedby': 'authError', onkeydown: (e) => { if (e.key === 'Enter') doForgotPassword() } })) }
  const btnLabel = S.authMode === 'login' ? 'Login' : S.authMode === 'forgot' ? 'Send Reset Link' : 'Create Account';
  const btnAction = S.authMode === 'login' ? doLogin : S.authMode === 'forgot' ? doForgotPassword : doRegister;
  form.appendChild(h('button', { className: 'btn btn-primary', id: 'authBtn', onclick: btnAction }, btnLabel));
  if (S.authMode === 'login') { const forgotLink = h('div', { style: 'text-align:center;margin-top:12px' }); forgotLink.appendChild(h('a', { href: '#', style: 'color:var(--accent);font-size:13px;text-decoration:none', onclick: (e) => { e.preventDefault(); S.authMode = 'forgot'; render() } }, 'Forgot password?')); form.appendChild(forgotLink) }
  screen.appendChild(form);
  container.appendChild(screen);
  setTimeout(() => { const inp = S.authMode === 'forgot' ? $('#authEmail') : $('#authUsername'); if (inp) inp.focus() }, 100);
}

/**
 * renderLoadingOrJoin(container)
 * No deps needed.
 */
export function renderLoadingOrJoin(container) {
  const screen = h('div', { className: 'auth-screen' });
  screen.appendChild(h('div', { className: 'logo-big' }, 'FESTIE'));
  screen.appendChild(h('div', { className: 'tagline' }, 'Loading your festivals...'));
  container.appendChild(screen);
}

/**
 * showChangePassword(deps)
 * deps: { api, toast, render, trapFocus, refreshRealtimeSession }
 */
export function showChangePassword(deps) {
  const { api, toast, trapFocus, refreshRealtimeSession } = deps;
  const ov = h('div', { className: 'admin-login-overlay open', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cp-title' });
  const box = h('div', { className: 'admin-login-box' });
  box.appendChild(h('h2', { id: 'cp-title' }, 'CHANGE PASSWORD'));
  box.appendChild(h('p', {}, 'Enter your current and new password'));
  const err = h('div', { className: 'login-error', id: 'cpError', role: 'alert', 'aria-live': 'assertive' }, '\u00A0'); box.appendChild(err);
  box.appendChild(h('div', { className: 'form-row' }, h('label', { for: 'cpCurrent', className: 'sr-only' }, 'Current Password'), h('input', { type: 'password', placeholder: 'Current Password', id: 'cpCurrent', autocomplete: 'current-password', 'aria-describedby': 'cpError' })));
  box.appendChild(h('div', { className: 'form-row' }, h('label', { for: 'cpNew', className: 'sr-only' }, 'New Password'), h('input', { type: 'password', placeholder: 'New Password', id: 'cpNew', autocomplete: 'new-password', 'aria-describedby': 'cpError' })));
  const pi = h('input', { type: 'password', placeholder: 'Confirm New Password', id: 'cpConfirm', autocomplete: 'new-password', 'aria-describedby': 'cpError' });
  pi.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doChangePassword(ov, { api, toast, refreshRealtimeSession }) });
  box.appendChild(h('div', { className: 'form-row' }, h('label', { for: 'cpConfirm', className: 'sr-only' }, 'Confirm New Password'), pi));
  const br = h('div', { className: 'btn-row' });
  br.appendChild(h('button', { className: 'btn btn-ghost', onclick: () => { cleanupTrap(); ov.remove() } }, 'Cancel'));
  br.appendChild(h('button', { className: 'btn btn-primary', onclick: () => _doChangePassword(ov, { api, toast, refreshRealtimeSession }) }, 'Update'));
  box.appendChild(br); ov.appendChild(box);
  ov.addEventListener('click', (e) => { if (e.target === ov) { cleanupTrap(); ov.remove() } });
  document.body.appendChild(ov);
  const cleanupTrap = trapFocus(ov);
}

async function _doChangePassword(ov, { api, toast, refreshRealtimeSession }) {
  const cur = $('#cpCurrent')?.value; const nw = $('#cpNew')?.value; const cf = $('#cpConfirm')?.value; const errEl = $('#cpError');
  if (!cur || !nw) { if (errEl) errEl.textContent = 'Please fill in all fields'; return }
  if (nw !== cf) { if (errEl) errEl.textContent = 'New passwords do not match'; return }
  try { await api('/auth/change-password', { method: 'POST', body: { currentPassword: cur, newPassword: nw, confirmPassword: cf } }); S.userToken = null; refreshRealtimeSession(); ov.remove(); toast('Password updated!', 'success') } catch (e) { if (errEl) errEl.textContent = e.message || 'Failed' }
}

/**
 * showInstallInstructions(deps)
 * deps: { trapFocus }
 */
export function showInstallInstructions(deps) {
  const { trapFocus } = deps;
  const ua = navigator.userAgent; const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document); const isAndroid = /Android/.test(ua); const isFirefox = /Firefox/.test(ua); const isSamsung = /SamsungBrowser/.test(ua);
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line|Twitter|TikTok/i.test(ua);
  const isNonSafariIOS = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  let steps, warning = null;
  if (isInAppBrowser) { warning = 'This browser cannot install apps. Tap the ••• menu and choose \"Open in Safari\" (or your default browser), then try Install App again.'; steps = ['Tap the ••• menu in this app', 'Choose \"Open in Safari\" or \"Open in Browser\"', 'Tap Install App once the page reopens']; }
  else if (isNonSafariIOS) { warning = 'iOS only lets Safari add apps to the Home Screen. Open festie.us in Safari, then use the Share menu.'; steps = ['Copy the link below', 'Open Safari and paste it', 'Use Share → Add to Home Screen']; }
  else if (isIOS) steps = ['Tap the Share button (square with arrow ↑) at the bottom of Safari', 'Scroll down and tap \"Add to Home Screen\"', 'Tap \"Add\" in the top-right corner'];
  else if (isAndroid && isSamsung) steps = ['Tap the menu icon (☰) at the bottom', 'Tap \"Add page to\" → \"Home screen\"', 'Tap \"Add\" to confirm'];
  else if (isAndroid) steps = ['Tap the three-dot menu (⋮) in Chrome', 'Tap \"Add to Home Screen\" or \"Install App\"', 'Tap \"Install\" to confirm'];
  else if (isFirefox) steps = ['Click the three-line menu (☰)', 'Click \"More tools\" → \"Add to Desktop\"'];
  else steps = ['Click the install icon (⊕) in your browser address bar', 'Or use your browser menu → \"Install Festie\"'];
  const ov = h('div', { className: 'admin-login-overlay open', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'inst-title' });
  const box = h('div', { className: 'admin-login-box' });
  box.appendChild(h('h2', { id: 'inst-title' }, 'INSTALL APP'));
  box.appendChild(h('p', { style: { fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' } }, 'Add Festie to your home screen for the best experience — works offline, launches faster, and feels like a native app.'));
  if (warning) { const w = h('div', { className: 'install-inapp-warning' }); w.appendChild(h('strong', {}, 'Heads up: ')); w.appendChild(document.createTextNode(warning)); box.appendChild(w); }
  if (isInAppBrowser || isNonSafariIOS) {
    const urlBtn = h('button', { className: 'install-copy-url', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText('https://festie.us'); urlBtn.querySelector('.copy-label').textContent = 'Copied!'; setTimeout(() => { urlBtn.querySelector('.copy-label').textContent = 'Copy' }, 2000) } catch(e) {} } });
    urlBtn.appendChild(document.createTextNode('https://festie.us'));
    urlBtn.appendChild(h('span', { className: 'copy-label' }, 'Copy'));
    box.appendChild(urlBtn);
  }
  const ol = h('ol', { style: { paddingLeft: '20px', margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: '10px' } });
  steps.forEach(s => ol.appendChild(h('li', { style: { fontSize: '13px', lineHeight: '1.5', color: 'var(--text-primary)' } }, s)));
  box.appendChild(ol);
  const br = h('div', { className: 'btn-row' });
  br.appendChild(h('button', { className: 'btn btn-primary', onclick: () => { cleanupTrap(); ov.remove() } }, 'Got It'));
  box.appendChild(br); ov.appendChild(box);
  ov.addEventListener('click', (e) => { if (e.target === ov) { cleanupTrap(); ov.remove() } });
  document.body.appendChild(ov);
  const cleanupTrap = trapFocus(ov);
}

/**
 * showChangeEmail(deps)
 * deps: { api, toast, trapFocus }
 */
export function showChangeEmail(deps) {
  const { api, toast, trapFocus } = deps;
  const ov = h('div', { className: 'admin-login-overlay open', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ce-title' });
  const box = h('div', { className: 'admin-login-box' });
  box.appendChild(h('h2', { id: 'ce-title' }, S.user?.email ? 'CHANGE EMAIL' : 'ADD EMAIL'));
  box.appendChild(h('p', {}, S.user?.email ? 'A verification link will be sent to your new address.' : 'Add an email for password resets and account recovery.'));
  const err = h('div', { className: 'login-error', id: 'ceError', role: 'alert', 'aria-live': 'assertive' }, '\u00A0'); box.appendChild(err);
  if (S.user?.email) {
    const curRow = h('div', { className: 'account-current-email' });
    curRow.appendChild(h('span', { className: 'account-setting-key', style: { fontSize: '12px' } }, 'Current'));
    const curVal = h('span', { style: { fontSize: '13px', color: 'var(--text-primary)' } });
    curVal.appendChild(document.createTextNode(S.user.email));
    if (S.user.emailVerified) curVal.appendChild(h('span', { className: 'account-verified-badge' }, 'Verified'));
    else curVal.appendChild(h('span', { className: 'account-unverified-badge' }, 'Unverified'));
    curRow.appendChild(curVal);
    box.appendChild(curRow);
  }
  box.appendChild(h('div', { className: 'form-row' }, h('label', { for: 'ceEmail', className: 'sr-only' }, 'New Email'), h('input', { type: 'email', placeholder: 'New email address', id: 'ceEmail', autocomplete: 'email', 'aria-describedby': 'ceError' })));
  const pi = h('input', { type: 'password', placeholder: 'Confirm your password', id: 'cePassword', autocomplete: 'current-password', 'aria-describedby': 'ceError' });
  pi.addEventListener('keydown', (e) => { if (e.key === 'Enter') _doChangeEmail(ov, { api, toast }) });
  box.appendChild(h('div', { className: 'form-row' }, h('label', { for: 'cePassword', className: 'sr-only' }, 'Password'), pi));
  const br = h('div', { className: 'btn-row' });
  br.appendChild(h('button', { className: 'btn btn-ghost', onclick: () => { cleanupTrap(); ov.remove() } }, 'Cancel'));
  br.appendChild(h('button', { className: 'btn btn-primary', onclick: () => _doChangeEmail(ov, { api, toast }) }, S.user?.email ? 'Update Email' : 'Add Email'));
  box.appendChild(br); ov.appendChild(box);
  ov.addEventListener('click', (e) => { if (e.target === ov) { cleanupTrap(); ov.remove() } });
  document.body.appendChild(ov);
  const cleanupTrap = trapFocus(ov);
}

async function _doChangeEmail(ov, { api, toast }) {
  const email = $('#ceEmail')?.value?.trim(); const password = $('#cePassword')?.value; const errEl = $('#ceError');
  if (!email) { if (errEl) errEl.textContent = 'Please enter an email address'; return }
  if (!password) { if (errEl) errEl.textContent = 'Please enter your password to confirm'; return }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (errEl) errEl.textContent = 'Please enter a valid email address'; return }
  try {
    await api('/auth/update-email', { method: 'POST', body: { email, password } });
    S.user.email = email; S.user.emailVerified = false;
    ov.remove(); toast('Verification email sent to ' + email, 'success');
  } catch (e) { if (errEl) errEl.textContent = e.message || 'Failed to update email' }
}

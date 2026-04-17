/**
 * Header, SubHeader, BottomNav, UserMenu — Festie
 *
 * Extracted from app.js. Pattern: import shared modules directly,
 * receive app.js-specific functions via deps.
 */

import { S, PRI_MAP } from '../app/state.js?v=1776342458439';
import { openIOSInstallSheet, _internals as iosInternals } from '../app/ios-install-prompt.js?v=1776342458439';
import { $, h } from '../app/dom.js?v=1776342458439';
import { formatTime, getAvatarColor, getInitials, normalizeIdentityName } from '../app/helpers.js?v=1776342458439';

/**
 * renderHeader(deps)
 * deps: { getPrimaryViews, enableTablistKeyboard, createAvatar, createSvgIcon,
 *         openAdminPanel, showUserMenu, navigate,
 *         toggleTheme, getTheme, showInstallInstructions, render }
 */
export function renderHeader(deps) {
  const { getPrimaryViews, enableTablistKeyboard, createAvatar, createSvgIcon, openAdminPanel, showUserMenu, navigate, toggleTheme, getTheme, showInstallInstructions, render , toggleFestivalMode, isFestivalMode, renderFestivalModeToggle } = deps;
  const header = h('header', { className: 'header' });
  const left = h('div', { className: 'header-left' });
  left.appendChild(h('div', { className: 'conn-status ' + (S.connected ? 'connected' : S.sseFallback ? 'fallback' : 'disconnected'), role: 'status', 'aria-label': S.connected ? 'Connected' : S.sseFallback ? 'Reconnecting (fallback)' : 'Disconnected' }));
  const brandGroup = h('div', { className: 'header-brand' });
  brandGroup.appendChild(h('h1', { className: 'logo' }, 'FESTIE'));
  const utilStrip = h('div', { className: 'header-util-strip' });
  const _svg = (paths) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('aria-hidden', 'true'); paths.forEach(d => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p) }); return s };
  const _isStandalone = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone;
  const _installHandler = async () => { const ios = iosInternals.detectIOS(); if (S.installPromptEvent) { try { await S.installPromptEvent.prompt(); const choice = await S.installPromptEvent.userChoice; try { navigator.sendBeacon && navigator.sendBeacon('/api/v1/analytics/install', new Blob([JSON.stringify({platform:'android',event:choice?.outcome==='accepted'?'accepted':'dismissed'})], {type:'application/json'})) } catch(_){} if (choice?.outcome === 'accepted') { S.canInstall = false; S.installPromptEvent = null; deps.toast('Festie installed', 'success'); render() } else if (choice?.outcome === 'dismissed') { S.canInstall = false; S.installPromptEvent = null; } } catch(_){} return; } if (ios.isIOS && ios.isSafari && !ios.isStandalone) { openIOSInstallSheet({ force: true }); return; } showInstallInstructions(); };
  if (!_isStandalone && !S.appInstalled) utilStrip.appendChild(h('button', { className: 'util-btn util-install', type: 'button', 'data-testid': 'header-install-btn', onclick: _installHandler }, _svg(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3']), ' Install App'));
  utilStrip.appendChild(h('a', { className: 'util-btn util-support', href: 'https://paypal.me/uhsear', target: '_blank', rel: 'noopener noreferrer' }, _svg(['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z']), ' Support Me'));
  brandGroup.appendChild(utilStrip);
  left.appendChild(brandGroup);
  const nav = h('div', { className: 'desktop-nav', role: 'tablist', 'aria-label': 'View navigation' });
  getPrimaryViews().forEach(([view, label]) => { nav.appendChild(h('button', { className: S.view === view ? 'active' : '', role: 'tab', 'aria-selected': S.view === view ? 'true' : 'false', 'aria-controls': 'main-content', tabindex: S.view === view ? '0' : '-1', 'aria-label': 'View ' + label, onclick: () => navigate(view) }, label)) });
  enableTablistKeyboard(nav, 'horizontal');
  left.appendChild(nav);
  header.appendChild(left);
  const right = h('div', { className: 'header-right' });
  if (renderFestivalModeToggle) { right.appendChild(renderFestivalModeToggle()); }
  right.appendChild(h('button', { className: 'btn btn-ghost btn-sm theme-toggle', type: 'button', onclick: toggleTheme, 'aria-label': 'Toggle light/dark theme', title: getTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode' }, getTheme() === 'dark' ? '☀' : '🌙'));
  if (S.isAdmin) { right.appendChild(h('button', { className: 'admin-badge', type: 'button', onclick: openAdminPanel, 'aria-label': 'Open admin panel' }, createSvgIcon('admin'), document.createTextNode(' ADMIN'))) }
  if (S.user) {
    const badge = h('button', { className: 'profile-badge', type: 'button', onclick: showUserMenu, 'aria-label': 'Open user menu', 'data-testid': 'profile-badge' });
    badge.appendChild(createAvatar(S.user, { size: 26, fontSize: 11 }));
    const copy = h('div', { className: 'profile-copy' });
    copy.appendChild(h('strong', {}, S.user.username));
    copy.appendChild(h('span', { className: 'profile-subline' }, S.currentProfile ? (S.currentFestival?.name || 'Festival profile') : (S.currentFestival ? 'Not joined yet' : 'Account')));
    badge.appendChild(copy);
    right.appendChild(badge);
  }
  header.appendChild(right);
  return header;
}

/**
 * showUserMenu(deps)
 * deps: { getProfileSummary, getAvatarMeta, createAvatar, createIdentityBadge,
 *         showChangePassword, showChangeEmail, uploadAvatar, removeAvatar,
 *         openAdminPanel, doUserLogout, api, toast, render, joinCurrentFestival }
 */
export function showUserMenu(deps) {
  const { getProfileSummary, getAvatarMeta, createAvatar, createIdentityBadge, showChangePassword, showChangeEmail, uploadAvatar, removeAvatar, openAdminPanel, doUserLogout, api, toast, render, joinCurrentFestival } = deps;
  const existing = $('.user-menu-overlay'); if (existing) { existing.remove(); return }
  const summary = getProfileSummary();
  const ov = h('div', { className: 'user-menu-overlay' });
  const menu = h('div', { className: 'user-menu' });
  const card = h('div', { className: 'user-menu-profile-card', 'data-testid': 'user-menu-profile' });
  card.appendChild(createAvatar(S.user, { size: 52, fontSize: 18 }));
  const copy = h('div', { className: 'user-menu-copy' });
  copy.appendChild(h('div', { className: 'user-menu-name' }, S.user.username));
  copy.appendChild(h('div', { className: 'user-menu-subline' }, 'Account identity across every festival'));
  const badges = h('div', { className: 'user-menu-badges' });
  badges.appendChild(createIdentityBadge('Account'));
  if (S.isAdmin) badges.appendChild(createIdentityBadge('Admin', 'identity-badge-admin'));
  copy.appendChild(badges);
  card.appendChild(copy);
  menu.appendChild(card);
  if (S.currentFestival) {
    const festivalSection = h('section', { className: 'user-menu-section', 'data-testid': 'festival-profile-section' });
    festivalSection.appendChild(h('div', { className: 'user-menu-section-title' }, 'Festival Profile'));
    festivalSection.appendChild(h('div', { className: 'user-menu-section-copy' }, S.currentProfile ? `Specific to ${S.currentFestival.name}. Picks, notes, and crew coordination live here.` : `You have not joined ${S.currentFestival.name} yet. Join when you are ready to save picks and coordinate with the crew.`));
    const status = h('div', { className: 'user-menu-status' });
    status.appendChild(createIdentityBadge(S.currentProfile ? 'Joined' : 'Not joined', S.currentProfile ? ' identity-badge-self' : ''));
    if (S.currentProfile) status.appendChild(createIdentityBadge('Notes stay private'));
    festivalSection.appendChild(status);
    if (S.currentProfile) {
      const stats = h('div', { className: 'user-menu-stats' });
      [[summary.total, 'Total picks'], [summary.must, 'Must see'], [summary.want, 'Want to see'], [summary.notes, 'Notes']].forEach(([value, label]) => { const stat = h('div', { className: 'user-menu-stat' }); stat.appendChild(h('strong', {}, String(value))); stat.appendChild(h('span', {}, label)); stats.appendChild(stat) });
      festivalSection.appendChild(stats);
      const festivalActions = h('div', { className: 'user-menu-actions' });
      festivalSection.appendChild(festivalActions);
    } else {
      festivalSection.appendChild(h('button', { className: 'btn btn-primary btn-sm', type: 'button', disabled: S.joinBusy || null, 'aria-busy': S.joinBusy ? 'true' : 'false', 'data-testid': 'user-menu-join-festival-button', onclick: async () => { ov.remove(); await joinCurrentFestival() } }, S.joinBusy ? 'Joining...' : 'Join Festival'));
    }
    menu.appendChild(festivalSection);
  }
  const accountSection = h('section', { className: 'user-menu-section', 'data-testid': 'account-section' });
  accountSection.appendChild(h('div', { className: 'user-menu-section-title' }, 'Account'));
  // Photo
  const photoRow = h('div', { className: 'account-setting-row' });
  const photoLabel = h('div', { className: 'account-setting-label' });
  photoLabel.appendChild(h('span', { className: 'account-setting-key' }, 'Photo'));
  photoLabel.appendChild(h('span', { className: 'account-setting-value' }, 'JPG, PNG, GIF, or WebP up to 5MB'));
  photoRow.appendChild(photoLabel);
  const photoActions = h('div', { className: 'account-setting-actions' });
  const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', style: { display: 'none' }, 'data-testid': 'avatar-file-input' });
  fileInput.addEventListener('change', async () => { const file = fileInput.files?.[0]; fileInput.value = ''; await uploadAvatar(file) });
  photoActions.appendChild(fileInput);
  photoActions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', disabled: S.avatarBusy || null, 'data-testid': 'avatar-upload-button', onclick: () => { if (!S.avatarBusy) fileInput.click() } }, S.avatarBusy ? 'Uploading...' : 'Upload'));
  if (S.user?.avatarUrl) photoActions.appendChild(h('button', { className: 'btn btn-ghost btn-sm btn-muted', type: 'button', disabled: S.avatarBusy || null, 'data-testid': 'avatar-remove-button', onclick: removeAvatar }, 'Remove'));
  photoRow.appendChild(photoActions);
  accountSection.appendChild(photoRow);
  // Email
  const emailRow = h('div', { className: 'account-setting-row' });
  const emailLabel = h('div', { className: 'account-setting-label' });
  emailLabel.appendChild(h('span', { className: 'account-setting-key' }, 'Email'));
  if (S.user?.email) {
    const emailVal = h('span', { className: 'account-setting-value' });
    emailVal.appendChild(document.createTextNode(S.user.email));
    if (S.user.emailVerified) { emailVal.appendChild(h('span', { className: 'account-verified-badge' }, 'Verified')) }
    else { emailVal.appendChild(h('span', { className: 'account-unverified-badge' }, 'Unverified')) }
    emailLabel.appendChild(emailVal);
  } else { emailLabel.appendChild(h('span', { className: 'account-setting-value account-setting-empty' }, 'Not set')) }
  emailRow.appendChild(emailLabel);
  const emailActions = h('div', { className: 'account-setting-actions' });
  emailActions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { ov.remove(); showChangeEmail() } }, S.user?.email ? 'Change' : 'Add'));
  if (S.user?.email && !S.user.emailVerified) emailActions.appendChild(h('button', { className: 'btn btn-ghost btn-sm btn-muted', type: 'button', onclick: async () => { try { await api('/auth/resend-verification', { method: 'POST' }); toast('Verification email sent', 'success') } catch (e) { toast(e.message || 'Failed to send', 'error') } } }, 'Resend'));
  emailRow.appendChild(emailActions);
  accountSection.appendChild(emailRow);
  // Password
  const pwRow = h('div', { className: 'account-setting-row' });
  const pwLabel = h('div', { className: 'account-setting-label' });
  pwLabel.appendChild(h('span', { className: 'account-setting-key' }, 'Password'));
  pwLabel.appendChild(h('span', { className: 'account-setting-value' }, '••••••••'));
  pwRow.appendChild(pwLabel);
  const pwActions = h('div', { className: 'account-setting-actions' });
  pwActions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { ov.remove(); showChangePassword() } }, 'Change'));
  pwRow.appendChild(pwActions);
  accountSection.appendChild(pwRow);
  // App section — Install + Support (especially useful on mobile where header util-strip is hidden)
  const _isStandaloneMenu = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone;
  if (!_isStandaloneMenu && !S.appInstalled) {
    const appSection = h('section', { className: 'user-menu-section', 'data-testid': 'app-section' });
    appSection.appendChild(h('div', { className: 'user-menu-section-title' }, 'App'));
    const appActions = h('div', { className: 'user-menu-app-actions' });
    const installSvg = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('aria-hidden', 'true'); ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'].forEach(d => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p) }); return s };
    appActions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', 'data-testid': 'menu-install-btn', onclick: () => { ov.remove(); const ios = iosInternals.detectIOS(); if (S.installPromptEvent) { S.installPromptEvent.prompt().then(() => { const choice = S.installPromptEvent.userChoice; if (choice?.outcome === 'accepted') { S.canInstall = false; S.installPromptEvent = null; toast('Festie installed', 'success'); render() } else if (choice?.outcome === 'dismissed') { S.canInstall = false; S.installPromptEvent = null; } }).catch(() => {}); return } if (ios.isIOS && ios.isSafari && !ios.isStandalone) { openIOSInstallSheet({ force: true }); return } if (typeof window !== 'undefined' && window.fpShowInstall) { window.fpShowInstall() } } }, installSvg(), document.createTextNode(' Install App')));
    appActions.appendChild(h('a', { className: 'btn btn-ghost btn-sm', href: 'https://paypal.me/uhsear', target: '_blank', rel: 'noopener noreferrer', 'data-testid': 'menu-support-btn' }, (() => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z'); s.appendChild(p); return s })(), document.createTextNode(' Support Festie')));
    appSection.appendChild(appActions);
    menu.appendChild(appSection);
  }
  // ── Notification Preferences section ──────────────────────────────────
  if (S.user) {
    const notifSection = h('section', { className: 'user-menu-section', 'data-testid': 'notif-prefs-section' });
    notifSection.appendChild(h('div', { className: 'user-menu-section-title' }, 'Notifications'));
    
    // Load prefs and render toggle rows
    const notifPrefsContainer = h('div', { className: 'notif-prefs-container' });
    notifSection.appendChild(notifPrefsContainer);
    
    // Async load + render prefs
    (async () => {
      try {
        const res = await (await fetch('/api/v1/notifications/prefs', { credentials: 'same-origin' })).json();
        const prefs = res.data || {};
        notifPrefsContainer.replaceChildren();
        
        const prefItems = [
          ['crewUpdates', 'Crew activity', 'Join/leave, picks shared'],
          ['setReminders', 'Set reminders', 'Alert before your picks'],
          ['scheduleChanges', 'Schedule changes', 'Lineup updates & cancellations'],
        ];
        
        prefItems.forEach(([key, label, desc]) => {
          const row = h('div', { className: 'notif-pref-row' });
          const labelEl = h('div', { className: 'notif-pref-label' });
          labelEl.appendChild(h('span', { className: 'notif-pref-name' }, label));
          labelEl.appendChild(h('span', { className: 'notif-pref-desc' }, desc));
          row.appendChild(labelEl);
          
          const currentVal = prefs[key] !== false; // default true
          const toggle = h('button', {
            className: 'notif-pref-toggle' + (currentVal ? ' active' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': currentVal ? 'true' : 'false',
            'aria-label': label,
            onclick: async (e) => {
              const btn = e.currentTarget;
              const newVal = btn.getAttribute('aria-checked') !== 'true';
              btn.setAttribute('aria-checked', newVal ? 'true' : 'false');
              btn.className = 'notif-pref-toggle' + (newVal ? ' active' : '');
              try {
                await fetch('/api/v1/notifications/prefs', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin',
                  body: JSON.stringify({ [key]: newVal })
                });
              } catch (_) {}
            }
          });
          toggle.appendChild(h('span', { className: 'notif-toggle-track' }));
          row.appendChild(toggle);
          notifPrefsContainer.appendChild(row);
        });
        
        // DnD row
        if (prefs.dndStart || prefs.dndEnd) {
          const dndRow = h('div', { className: 'notif-pref-row notif-dnd-row' });
          dndRow.appendChild(h('span', { className: 'notif-pref-name' }, 'Do Not Disturb'));
          dndRow.appendChild(h('span', { style: { fontSize: '12px', color: 'var(--text-secondary)' } }, (prefs.dndStart || '--:--') + ' – ' + (prefs.dndEnd || '--:--')));
          notifPrefsContainer.appendChild(dndRow);
        }
      } catch (_) {
        notifPrefsContainer.appendChild(h('span', { style: { fontSize: '12px', color: 'var(--text-secondary)' } }, 'Could not load notification settings'));
      }
    })();
    
    menu.appendChild(notifSection);
  }

  // Bottom actions
  const actions = h('div', { className: 'user-menu-actions', style: { marginTop: '12px' } });
  if (S.isAdmin) { actions.appendChild(h('button', { className: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { ov.remove(); openAdminPanel() } }, 'Admin Panel')); }
  if (S.currentProfile) {
    const shareBtn = h('button', { className: 'btn btn-ghost btn-sm', type: 'button', onclick: async () => {
      shareBtn.disabled = true; shareBtn.textContent = 'Generating…';
      try { const result = await shareSchedule(); toast(result.method === 'share' ? 'Shared!' : 'Downloaded!', 'success'); }
      catch (e) { toast(e.message || 'Failed to generate image', 'error'); }
      shareBtn.disabled = false; shareBtn.textContent = 'Share Schedule';
      ov.remove();
    } }, 'Share Schedule');
    actions.appendChild(shareBtn);
  }
  actions.appendChild(h('button', { className: 'btn btn-danger btn-sm', type: 'button', onclick: () => { ov.remove(); doUserLogout() } }, 'Logout'));
  accountSection.appendChild(actions);
  menu.appendChild(accountSection);
  ov.appendChild(menu);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove() });
  document.body.appendChild(ov);
}

/**
 * renderSubHeader(deps)
 * deps: { getDays, createSvgIcon, loadFestivalContext, toast, render, enableTablistKeyboard }
 */
export function renderSubHeader(deps) {
  const { getDays, createSvgIcon, loadFestivalContext, toast, render, enableTablistKeyboard } = deps;
  // Mobile expand-tap: on mobile only, tapping the sub-header area (but not inner controls)
  // expands a collapsed schedule header. Keyboard users get the same capability via an
  // Enter/Space handler when focus is on the sub-header element itself (not an inner control).
  const _expandIfCollapsed = (e) => {
    if (window.innerWidth > 768) return;
    if (!e.target.closest('.sub-header')) return;
    if (e.target.closest('select') || e.target.closest('button') || e.target.closest('input') || e.target.closest('.stage-chip')) return;
    const mc = document.querySelector('.main-content');
    if (mc && mc.classList.contains('sub-header-collapsed')) { mc.classList.remove('sub-header-collapsed'); e.stopPropagation(); }
  };
  const sub = h('div', { className: 'sub-header', 'aria-label': 'Festival schedule controls', onclick: _expandIfCollapsed, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') _expandIfCollapsed(e); } });
  const label = h('label', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginRight: '6px', display: 'inline-block', fontWeight: '600' }, 'for': 'festival-select-input' }, 'Festival:');
  sub.appendChild(label);
  const select = h('select', { id: 'festival-select-input', className: 'festival-select', 'data-testid': 'festival-select', onchange: async (e) => { const id = e.target.value; if (!id) return; try { S.selectedDay = 0; await loadFestivalContext(id); render() } catch (e) { toast('Failed to load festival', 'error') } } });
  select.appendChild(h('option', { value: '' }, 'Select Festival'));
  S.festivals.forEach(f => { const opt = h('option', { value: f.id }, f.name); if (f.id === S.currentFestival?.id) opt.selected = true; select.appendChild(opt) }); sub.appendChild(select);
  if (S.currentFestival) { const days = getDays(); if (days.length > 0) { const dt = h('div', { className: 'day-tabs', role: 'tablist', 'aria-label': 'Festival days' }); days.forEach((d, i) => { dt.appendChild(h('button', { className: 'day-tab' + (S.selectedDay === i ? ' active' : ''), role: 'tab', 'aria-selected': S.selectedDay === i ? 'true' : 'false', 'aria-controls': 'main-content', tabindex: S.selectedDay === i ? '0' : '-1', onclick: () => { S.selectedDay = i; render() } }, d.label)) }); enableTablistKeyboard(dt, 'horizontal'); sub.appendChild(dt) } }
  if (S.currentFestival?.stages) { const sf = h('div', { className: 'filter-stage', role: 'group', 'aria-label': 'Filter by stage' }); S.currentFestival.stages.forEach(stage => { const active = S.activeStages.includes(stage.id); sf.appendChild(h('button', { className: 'stage-chip' + (active ? ' active' : ''), style: { color: stage.color, background: stage.color + '20' }, 'aria-pressed': active ? 'true' : 'false', 'aria-label': stage.name + (active ? ' (selected)' : ''), onclick: () => { if (active) S.activeStages = S.activeStages.filter(s => s !== stage.id); else S.activeStages.push(stage.id); render() } }, stage.name)) }); sub.appendChild(sf) }
  const sb = h('div', { className: 'search-box', role: 'search' }); sb.appendChild(createSvgIcon('search'));
  let _searchDebounce;
  sb.appendChild(h('input', { type: 'text', className: 'search-input', placeholder: 'Search artist...', value: S.searchQuery, 'aria-label': 'Search festival artists', oninput: (e) => { S.searchQuery = e.target.value; clearTimeout(_searchDebounce); _searchDebounce = setTimeout(() => render(), 150) } })); sub.appendChild(sb); return sub;
}

/**
 * renderNoFestival()
 * No deps needed.
 */
export function renderNoFestival() { return h('div', { className: 'no-festival' }, h('div', { className: 'icon' }, '🎪'), h('p', {}, 'Select a festival above to get started.')) }

/**
 * renderLoadingSkeleton()
 * No deps needed.
 */
export function renderLoadingSkeleton() { const skel = h('div', { className: 'loading-skeleton', 'aria-busy': 'true', 'aria-label': 'Loading festival data' }); for (let i = 0; i < 4; i++) { skel.appendChild(h('div', { className: 'skeleton-card' }, h('div', { className: 'skeleton-line skeleton-title' }), h('div', { className: 'skeleton-line skeleton-time' }), h('div', { className: 'skeleton-line skeleton-stage' }))) } return skel }

/**
 * renderBottomNav(deps)
 * deps: { getPrimaryViews, enableTablistKeyboard, createSvgIcon, navigate, render }
 */
export function renderBottomNav(deps) {
  const { getPrimaryViews, enableTablistKeyboard, createSvgIcon, navigate, render } = deps;
  const nav = h('footer', { className: 'bottom-nav', role: 'contentinfo' }); const inner = h('div', { className: 'bottom-nav-inner', role: 'tablist', 'aria-label': 'Main navigation' });
  getPrimaryViews().forEach(([view, label]) => { inner.appendChild(h('button', { className: S.view === view ? 'active' : '', role: 'tab', 'aria-selected': S.view === view ? 'true' : 'false', 'aria-controls': 'main-content', tabindex: S.view === view ? '0' : '-1', 'aria-label': 'View ' + label, onclick: () => navigate(view) }, createSvgIcon(view), h('span', {}, label))) });
  enableTablistKeyboard(inner, 'horizontal');
  nav.appendChild(inner); return nav;
}

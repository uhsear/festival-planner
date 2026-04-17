/**
 * iOS Install Prompt — slide-up bottom sheet
 *
 * iOS Safari has no beforeinstallprompt API. This module shows a one-time
 * bottom sheet on first visit (once engagement conditions are met) pointing
 * users to Safari's Share → Add to Home Screen flow.
 *
 * Conditions to show:
 *   - UA matches iPhone/iPad/iPod
 *   - Not already installed (navigator.standalone !== true)
 *   - Is real Safari (not Chrome/Firefox/in-app webview)
 *   - Not dismissed in the last 30 days
 *   - User has been on page ≥ 10s AND tapped at least once
 */

const LS_DISMISSED = 'fp:install:ios-dismissed-at';
const LS_SHOWN_COUNT = 'fp:install:ios-shown';
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MIN_ENGAGEMENT_MS = 10_000;
const MAX_SHOWS = 3;

function detectIOS() {
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
  if (!isIOS) return { isIOS: false };
  const isInAppBrowser = /FBAN|FBAV|Instagram|Line|Twitter|TikTok/i.test(ua);
  const isNonSafari = /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode:standalone)').matches;
  return { isIOS: true, isInAppBrowser, isNonSafari, isStandalone, isSafari: !isInAppBrowser && !isNonSafari };
}

function shouldShow() {
  const d = detectIOS();
  if (!d.isIOS || d.isStandalone || d.isInAppBrowser || d.isNonSafari) return false;
  const lastDismiss = parseInt(localStorage.getItem(LS_DISMISSED) || '0', 10);
  if (lastDismiss && (Date.now() - lastDismiss) < DISMISS_COOLDOWN_MS) return false;
  const shown = parseInt(localStorage.getItem(LS_SHOWN_COUNT) || '0', 10);
  if (shown >= MAX_SHOWS) return false;
  return true;
}

function reportAnalytics(event, extra = {}) {
  try {
    const body = JSON.stringify({ platform: 'ios', event, ...extra });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/v1/analytics/install', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/v1/analytics/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch (_) { /* non-blocking */ }
}

function buildSheet() {
  const sheet = document.createElement('div');
  sheet.className = 'ios-install-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'ios-install-title');

  // Scrim
  const scrim = document.createElement('div');
  scrim.className = 'ios-install-scrim';
  scrim.setAttribute('data-dismiss', 'scrim');

  // Panel
  const panel = document.createElement('div');
  panel.className = 'ios-install-panel panel-entering';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ios-install-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.setAttribute('data-dismiss', 'close');
  closeBtn.textContent = '\u00D7'; // ×

  // Header
  const header = document.createElement('div');
  header.className = 'ios-install-header';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'ios-install-icon';
  iconWrap.setAttribute('aria-hidden', 'true');
  const iconImg = document.createElement('img');
  iconImg.src = '/icons/icon-192.png';
  iconImg.alt = '';
  iconImg.width = 56;
  iconImg.height = 56;
  iconImg.loading = 'lazy';
  iconWrap.append(iconImg);

  const title = document.createElement('h2');
  title.id = 'ios-install-title';
  title.textContent = 'Add Festie to Home Screen';

  const tagline = document.createElement('p');
  tagline.className = 'ios-install-tagline';
  tagline.textContent = 'Launch faster, works offline, full-screen experience';

  header.append(iconWrap, title, tagline);

  // Steps list
  const steps = document.createElement('ol');
  steps.className = 'ios-install-steps';

  // Step 1: "Tap the Share button ⬆️ at the bottom of Safari"
  const step1 = document.createElement('li');
  const step1Num = document.createElement('span');
  step1Num.className = 'ios-step-num';
  step1Num.textContent = '1';
  const step1Body = document.createElement('span');
  step1Body.className = 'ios-step-body';
  step1Body.append('Tap the ');
  const step1Strong = document.createElement('strong');
  step1Strong.textContent = 'Share';
  step1Body.append(step1Strong, ' button ');
  const shareGlyph = document.createElement('span');
  shareGlyph.className = 'ios-share-glyph';
  shareGlyph.setAttribute('aria-hidden', 'true');
  shareGlyph.textContent = '\u2B06\uFE0F'; // ⬆️
  step1Body.append(shareGlyph, ' at the bottom of Safari');
  step1.append(step1Num, step1Body);

  // Step 2
  const step2 = document.createElement('li');
  const step2Num = document.createElement('span');
  step2Num.className = 'ios-step-num';
  step2Num.textContent = '2';
  const step2Body = document.createElement('span');
  step2Body.className = 'ios-step-body';
  step2Body.append('Scroll and tap ');
  const step2Strong = document.createElement('strong');
  step2Strong.textContent = 'Add to Home Screen';
  step2Body.append(step2Strong);
  step2.append(step2Num, step2Body);

  // Step 3
  const step3 = document.createElement('li');
  const step3Num = document.createElement('span');
  step3Num.className = 'ios-step-num';
  step3Num.textContent = '3';
  const step3Body = document.createElement('span');
  step3Body.className = 'ios-step-body';
  step3Body.append('Tap ');
  const step3Strong = document.createElement('strong');
  step3Strong.textContent = 'Add';
  step3Body.append(step3Strong, ' in the top-right corner');
  step3.append(step3Num, step3Body);

  steps.append(step1, step2, step3);

  // Arrow (SVG)
  const arrowWrap = document.createElement('div');
  arrowWrap.className = 'ios-install-arrow';
  arrowWrap.setAttribute('aria-hidden', 'true');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 40');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '40');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path1 = document.createElementNS(SVG_NS, 'path');
  path1.setAttribute('d', 'M12 3v32');
  const path2 = document.createElementNS(SVG_NS, 'path');
  path2.setAttribute('d', 'M4 27l8 8 8-8');
  svg.append(path1, path2);
  arrowWrap.append(svg);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'ios-install-actions';

  const laterBtn = document.createElement('button');
  laterBtn.className = 'btn btn-ghost btn-sm';
  laterBtn.type = 'button';
  laterBtn.setAttribute('data-dismiss', 'later');
  laterBtn.textContent = 'Maybe later';

  const gotItBtn = document.createElement('button');
  gotItBtn.className = 'btn btn-primary btn-sm';
  gotItBtn.type = 'button';
  gotItBtn.setAttribute('data-dismiss', 'got-it');
  gotItBtn.textContent = 'Got it';

  actions.append(laterBtn, gotItBtn);

  panel.append(closeBtn, header, steps, arrowWrap, actions);
  sheet.replaceChildren(scrim, panel);
  return sheet;
}

function dismiss(sheet, reason) {
  localStorage.setItem(LS_DISMISSED, String(Date.now()));
  reportAnalytics('dismissed', { reason });
  const panel = sheet.querySelector('.ios-install-panel');
  if (panel) {
    panel.classList.remove('panel-entering');
    panel.classList.add('panel-exiting');
    panel.addEventListener('animationend', () => sheet.remove(), { once: true });
    setTimeout(() => sheet.isConnected && sheet.remove(), 400); // safety
  } else {
    sheet.remove();
  }
}

export function openIOSInstallSheet({ force = false } = {}) {
  if (!force && !shouldShow()) return false;
  if (document.querySelector('.ios-install-sheet')) return false;

  const sheet = buildSheet();
  document.body.appendChild(sheet);

  // Focus trap — focus first interactive element
  const firstBtn = sheet.querySelector('.ios-install-close');
  if (firstBtn) setTimeout(() => firstBtn.focus(), 50);

  sheet.addEventListener('click', (e) => {
    const target = e.target.closest('[data-dismiss]');
    if (!target) return;
    dismiss(sheet, target.getAttribute('data-dismiss'));
  });

  const esc = (e) => { if (e.key === 'Escape') { dismiss(sheet, 'escape'); document.removeEventListener('keydown', esc) } };
  document.addEventListener('keydown', esc);

  const shown = parseInt(localStorage.getItem(LS_SHOWN_COUNT) || '0', 10);
  localStorage.setItem(LS_SHOWN_COUNT, String(shown + 1));
  reportAnalytics('shown');

  return true;
}

/**
 * initIOSInstallPrompt — call once at app start after render.
 * Waits for engagement (≥10s and ≥1 tap), then shows the sheet if eligible.
 */
export function initIOSInstallPrompt() {
  if (!shouldShow()) return;

  const startedAt = Date.now();
  let hasTapped = false;

  const onTap = () => {
    hasTapped = true;
    document.removeEventListener('pointerdown', onTap);
    document.removeEventListener('touchstart', onTap);
  };
  document.addEventListener('pointerdown', onTap, { passive: true });
  document.addEventListener('touchstart', onTap, { passive: true });

  const check = () => {
    if (!shouldShow()) return; // may have changed (e.g. installed)
    const elapsed = Date.now() - startedAt;
    if (elapsed >= MIN_ENGAGEMENT_MS && hasTapped) {
      openIOSInstallSheet();
    } else {
      setTimeout(check, 2000);
    }
  };
  setTimeout(check, MIN_ENGAGEMENT_MS);
}

export const _internals = { detectIOS, shouldShow };

/**
 * Focus management — trap focus, overlay lifecycle, tablist keyboard
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */

import { h } from './dom.js?v=1776342458439';

/**
 * Trap keyboard focus inside an element (for modals/dialogs).
 * Returns a cleanup function to remove the trap.
 */
export function trapFocus(el) {
  const focusable = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const first = el.querySelector(focusable);
  const onKey = e => {
    if (e.key === 'Escape') { el.dispatchEvent(new CustomEvent('modal-close')); return; }
    if (e.key !== 'Tab') return;
    const all = [...el.querySelectorAll(focusable)];
    const last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === all[0]) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); all[0].focus(); }
  };
  el.addEventListener('keydown', onKey);
  if (first) first.focus();
  return () => el.removeEventListener('keydown', onKey);
}

/**
 * Open a modal overlay. Returns a cleanup function.
 * Restores focus to the trigger element on close.
 */
export function openOverlay(ov) {
  const trigger = document.activeElement;
  const cleanup = () => {
    ov.remove();
    if (trigger && typeof trigger.focus === 'function') try { trigger.focus(); } catch (_) {}
  };
  ov._cleanup = cleanup;
  requestAnimationFrame(() => {
    const panel = ov.querySelector('[role="dialog"],.detail-panel,.admin-overlay,.crew-overlay') || ov;
    trapFocus(panel);
  });
  return cleanup;
}

/**
 * WAI-ARIA tablist keyboard navigation (P1.7).
 * Arrow keys + Home/End move focus between [role="tab"] children.
 */
export function enableTablistKeyboard(tablist) {
  tablist.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    if (tabs.length === 0) return;
    const idx = tabs.indexOf(document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    tabs[next].focus();
    tabs[next].click();
  });
}

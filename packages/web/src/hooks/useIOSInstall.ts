import { useEffect, useState } from 'react';

// Storage keys — match the legacy public/app/ios-install-prompt.js so users
// who previously dismissed the legacy prompt don't see it again in React.
const DISMISSED_AT_KEY = 'fp:install:ios-dismissed-at';
const SHOW_COUNT_KEY   = 'fp:install:ios-show-count';
const DISMISSED_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_SHOWS = 3;
const ENGAGEMENT_MIN_MS = 10_000; // 10s on site before we can prompt
const ENGAGEMENT_MIN_INTERACTIONS = 1;

export interface UseIOSInstallReturn {
  /** True when the install sheet should be rendered. */
  shouldShow: boolean;
  /** User dismissed the sheet. Recorded with a 30-day cooldown. */
  dismiss: (reason: 'close' | 'later' | 'got-it' | 'scrim' | 'escape') => void;
}

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    // iPadOS reports Mac but has touch
    (/Mac/.test(ua) && 'ontouchend' in document);
  if (!isIOS) return false;
  // Filter in-app browsers that can't install PWAs
  const inAppBrowser = /(FBAN|FBAV|Instagram|Line|Twitter|TikTok|Pinterest|Snapchat)/i.test(ua);
  if (inAppBrowser) return false;
  // Filter non-Safari iOS browsers (Chrome, Firefox on iOS can't install PWAs either)
  if (/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua)) return false;
  return true;
}

function isStandalone(): boolean {
  return (
    (typeof navigator !== 'undefined' && (navigator as any).standalone === true) ||
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
    false
  );
}

function readCount(): number {
  try { return Number(localStorage.getItem(SHOW_COUNT_KEY) || 0); } catch { return 0; }
}

function readDismissedAt(): number {
  try { return Number(localStorage.getItem(DISMISSED_AT_KEY) || 0); } catch { return 0; }
}

function canShow(): boolean {
  if (!isIOSSafari()) return false;
  if (isStandalone()) return false;
  const now = Date.now();
  const dismissedAt = readDismissedAt();
  if (dismissedAt && now - dismissedAt < DISMISSED_COOLDOWN_MS) return false;
  if (readCount() >= MAX_SHOWS) return false;
  return true;
}

/**
 * Drives the iOS "Add to Home Screen" sheet. Respects:
 *  - 30-day dismissal cooldown (matches legacy storage keys)
 *  - Max 3 shows total
 *  - Engagement gate: >= 10s on page AND >= 1 user interaction
 *  - Excludes standalone (already installed) + in-app browsers + non-Safari iOS
 *
 * Best-practice port of `public/app/ios-install-prompt.js` into React.
 */
export function useIOSInstall(): UseIOSInstallReturn {
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!canShow()) return;

    let interactions = 0;
    let timeOnPageHit = false;
    let shown = false;

    const tryShow = () => {
      if (shown) return;
      if (!timeOnPageHit) return;
      if (interactions < ENGAGEMENT_MIN_INTERACTIONS) return;
      shown = true;
      try {
        localStorage.setItem(SHOW_COUNT_KEY, String(readCount() + 1));
      } catch {/* ignore */}
      setShouldShow(true);
    };

    const timer = window.setTimeout(() => { timeOnPageHit = true; tryShow(); }, ENGAGEMENT_MIN_MS);
    const onInteract = () => { interactions++; tryShow(); };

    window.addEventListener('pointerdown', onInteract, { passive: true });
    window.addEventListener('touchstart', onInteract, { passive: true });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onInteract);
      window.removeEventListener('touchstart', onInteract);
    };
  }, []);

  const dismiss = (_reason: 'close' | 'later' | 'got-it' | 'scrim' | 'escape') => {
    try { localStorage.setItem(DISMISSED_AT_KEY, String(Date.now())); } catch {/* ignore */}
    setShouldShow(false);
  };

  return { shouldShow, dismiss };
}

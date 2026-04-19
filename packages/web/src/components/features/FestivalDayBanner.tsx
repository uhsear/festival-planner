import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { useHaptics } from '../../hooks/useHaptics';

/**
 * FestivalDayBanner — nudges the user into Festival Mode on festival days
 * when the mode is off. Ported from legacy renderFestivalModeDayBanner in
 * public/app.js. The parent (AppShell) decides whether to render this at
 * all; once mounted it handles its own dismiss state for the current
 * session via sessionStorage (survives tab navigation, not reloads — that's
 * intentional so a page refresh re-surfaces the nudge).
 */
const DISMISS_KEY = 'festie-fm-day-banner-dismissed';

export default function FestivalDayBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const setFestivalMode = useFestivalModeStore((s) => s.setFestivalMode);
  const navigate = useNavigate();
  const { select } = useHaptics();

  if (dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, 'true'); } catch {}
    setDismissed(true);
  };

  const enter = () => {
    select();
    setFestivalMode(true);
    dismiss();
    navigate({ to: '/festival-mode' });
  };

  return (
    <div className="festival-mode-day-banner" role="status" data-testid="festival-day-banner">
      <span className="festival-mode-day-banner__text">
        <span aria-hidden="true">🎪 </span>It&apos;s festival day!
      </span>
      <button
        type="button"
        className="festival-mode-day-banner__enter"
        onClick={enter}
        data-testid="festival-day-banner-enter"
      >
        Enter Festival Mode
      </button>
      <button
        type="button"
        className="festival-mode-day-banner__close"
        onClick={dismiss}
        aria-label="Dismiss festival day reminder"
        data-testid="festival-day-banner-close"
      >
        ×
      </button>
    </div>
  );
}

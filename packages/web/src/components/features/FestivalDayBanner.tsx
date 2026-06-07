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
    try {
      sessionStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      /* sessionStorage unavailable */
    }
    setDismissed(true);
  };

  const enter = () => {
    select();
    setFestivalMode(true);
    dismiss();
    navigate({ to: '/festival-mode' });
  };

  return (
    <div
      className="flex items-center justify-between gap-2.5 bg-[linear-gradient(90deg,rgba(0,212,170,0.18),rgba(155,114,255,0.12))] border border-[rgba(0,212,170,0.3)] rounded-xl py-2.5 px-4 mx-3 my-2 text-sm text-text-primary animate-[fm-day-banner-slide_0.3s_ease-out]"
      role="status"
      data-testid="festival-day-banner"
    >
      <span className="flex-1">
        <span aria-hidden="true">🎪 </span>It&apos;s festival day!
      </span>
      <button
        type="button"
        className="shrink-0 bg-accent-aqua text-bg-primary border-none rounded-lg py-2 px-3.5 text-[13px] font-semibold cursor-pointer min-h-11 hover:brightness-110 active:scale-[0.97] transition-[transform,background-color,border-color,color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
        onClick={enter}
        data-testid="festival-day-banner-enter"
      >
        Enter Festival Mode
      </button>
      <button
        type="button"
        className="shrink-0 bg-transparent border-none text-text-secondary cursor-pointer text-xl p-0 px-1 leading-none min-h-11 min-w-11 hover:text-text-primary active:scale-[0.97] transition-[transform,background-color,border-color,color,opacity] duration-[var(--duration-fast)] ease-[var(--ease-out)]"
        onClick={dismiss}
        aria-label="Dismiss festival day reminder"
        data-testid="festival-day-banner-close"
      >
        ×
      </button>
    </div>
  );
}

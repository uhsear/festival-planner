import { useEffect, useMemo } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useFestivalModeStore, isTodayFestivalDay } from '@festie/shared/stores/festivalModeStore';

/**
 * Auto-enables Festival Mode when today is a festival day, unless the user
 * manually opted out. Returns `showDayBanner` for the shell to render
 * the festival-day nudge on non-mode routes.
 */
export function useFestivalMode(pathname: string) {
  const navigate = useNavigate();
  const days = useFestivalStore((s) => s.days);
  const setFestivalMode = useFestivalModeStore((s) => s.setFestivalMode);
  const fmOn = useFestivalModeStore((s) => s.isFestivalMode);
  const fmManuallyDisabled = useFestivalModeStore((s) => s.manuallyDisabled);

  const isFestivalDayToday = useMemo(() => {
    const dayDates = days.map((d) => d.date).filter(Boolean) as string[];
    return isTodayFestivalDay(dayDates);
  }, [days]);

  useEffect(() => {
    if (!isFestivalDayToday) return;
    if (fmManuallyDisabled) return;
    if (!fmOn) setFestivalMode(true);
    if (pathname === '/' || pathname === '/cards') {
      navigate({ to: '/festival-mode' });
    }
  }, [isFestivalDayToday, fmManuallyDisabled, setFestivalMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the day banner on festival days whenever the user has either
  // explicitly dismissed Festival Mode OR turned it off — and only on
  // non-mode routes.
  const showDayBanner = isFestivalDayToday && !fmOn && pathname !== '/festival-mode';

  return { showDayBanner };
}

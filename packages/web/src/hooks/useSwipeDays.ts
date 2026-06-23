import { useDrag } from '@use-gesture/react';
import { FestivalDay } from '@festie/shared/types/domain';
import { useHaptics } from './useHaptics';

export interface UseSwipeDaysReturn {
  bind: ReturnType<typeof useDrag>;
}

export interface UseSwipeDaysProps {
  days: FestivalDay[];
  selectedDay: number;
  onSelectDay: (day: number) => void;
}

/**
 * Swipe-between-days gesture hook using @use-gesture/react
 * Detects horizontal swipes to navigate between festival days
 * Includes haptic feedback on day changes and prevents vertical scroll interference
 *
 * @param props - Configuration object
 * @param props.days - Array of festival day objects
 * @param props.selectedDay - Index of currently selected day
 * @param props.onSelectDay - Callback invoked with new day index
 * @returns Object with gesture bind handlers to spread on container
 *
 * @example
 * const { bind } = useSwipeDays({
 *   days: festivalDays,
 *   selectedDay: currentDay,
 *   onSelectDay: (day) => setCurrentDay(day),
 * });
 * return <div {...bind()} className="touch-pan-y">...</div>;
 */
export function useSwipeDays({ days, selectedDay, onSelectDay }: UseSwipeDaysProps): UseSwipeDaysReturn {
  const { select } = useHaptics();

  const bind = useDrag(
    ({ swipe: [swipeX] }) => {
      // Only process if a swipe was detected
      if (swipeX === 0) return;

      let newDay = selectedDay;

      // Swipe left (swipeX < 0) → next day (standard carousel convention)
      if (swipeX < 0 && selectedDay < days.length - 1) {
        newDay = selectedDay + 1;
      }
      // Swipe right (swipeX > 0) → previous day
      else if (swipeX > 0 && selectedDay > 0) {
        newDay = selectedDay - 1;
      }

      // Only trigger if day actually changed
      if (newDay !== selectedDay) {
        select(); // Haptic feedback
        onSelectDay(newDay);
      }
    },
    {
      // Swipe gesture config (threshold distance and time)
      swipe: {
        distance: [50, 0], // [x, y] - only detect horizontal
        velocity: [0.3, 0], // [x, y]
      },
    },
  );

  return { bind };
}

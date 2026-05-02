import React, { useRef, useEffect } from 'react';
import { FestivalDay } from '@festie/shared/types';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useSwipeDays } from '../../hooks/useSwipeDays';

interface DayTabsProps {
  days: FestivalDay[];
  selectedDay: number;
  onSelectDay: (dayIndex: number) => void;
}

export default function DayTabs({ days, selectedDay, onSelectDay }: DayTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement>(null);

  // Set up swipe gesture handlers
  const { bind } = useSwipeDays({
    days,
    selectedDay: selectedDay === -1 ? 0 : selectedDay - 1,
    onSelectDay: (dayIndex) => {
      onSelectDay(dayIndex + 1);
    },
  });

  // Auto-scroll selected day tab into view
  useEffect(() => {
    if (selectedButtonRef.current) {
      selectedButtonRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [selectedDay]);

  const formatDayLabel = (day: FestivalDay, index: number): string => {
    if (!day.date) return `Day ${index + 1}`;
    const date = new Date(day.date);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div
      {...bind()}
      className="px-4 overflow-x-auto pb-2"
      style={{ touchAction: 'pan-y' }}
      ref={containerRef}
    >
      <div className="flex gap-2 min-w-min">
        <motion.button
          ref={selectedDay === -1 ? selectedButtonRef : undefined}
          onClick={() => onSelectDay(-1)}
          className={cn(
            'whitespace-nowrap px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
            selectedDay === -1
              ? 'bg-accent-aqua text-bg-primary'
              : 'bg-bg-card border border-border text-text-primary hover:border-border-light',
          )}
          role="tab"
          aria-selected={selectedDay === -1}
          layout
        >
          All Days
        </motion.button>
        {days.map((day, index) => (
          <motion.button
            key={day.id || index}
            ref={selectedDay === index + 1 ? selectedButtonRef : undefined}
            onClick={() => onSelectDay(index + 1)}
            className={cn(
              'whitespace-nowrap px-3 py-2 rounded-lg text-sm font-semibold transition-colors',
              selectedDay === index + 1
                ? 'bg-accent-aqua text-bg-primary'
                : 'bg-bg-card border border-border text-text-primary hover:border-border-light',
            )}
            role="tab"
            aria-selected={selectedDay === index + 1}
            layout
          >
            {formatDayLabel(day, index)}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

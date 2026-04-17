import React from 'react';
import { motion } from 'motion/react';
import { Flame } from 'lucide-react';
import { useFestivalModeStore } from '@festie/shared';
import { useHaptics } from '../../hooks/useHaptics';
import { cn } from '@/lib/utils';

/**
 * FestivalModeToggle: Toggle button for Festival Mode
 * - Shows flame icon
 * - Glowing coral background when active
 * - Pulse animation when on
 * - Haptic feedback on toggle
 */
export default function FestivalModeToggle() {
  const isFestivalMode = useFestivalModeStore((state) => state.isFestivalMode);
  const toggleFestivalMode = useFestivalModeStore(
    (state) => state.toggleFestivalMode,
  );
  const { select } = useHaptics();

  const handleToggle = () => {
    select();
    toggleFestivalMode();
  };

  return (
    <motion.button
      onClick={handleToggle}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'p-2 rounded-lg transition-all duration-300',
        isFestivalMode
          ? 'bg-accent-coral text-bg-primary shadow-lg shadow-accent-coral/50'
          : 'bg-glass text-text-secondary hover:text-text-primary',
      )}
    >
      {/* Pulse animation when festival mode is on */}
      {isFestivalMode && (
        <motion.div
          className="absolute inset-0 rounded-lg bg-accent-coral"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
          style={{ zIndex: -1 }}
        />
      )}

      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5" />
        <span className="text-sm font-medium hidden sm:inline">
          Festival Mode
        </span>
      </div>
    </motion.button>
  );
}

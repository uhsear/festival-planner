import React from 'react';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { BatteryLow } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  className?: string;
}

/**
 * Small "Low power" pill shown while festival low-power mode is active, so the
 * reduced-affordance state is never silent. Reads the shared persisted flag.
 * Renders nothing when low-power mode is off.
 */
export default function LowPowerIndicator({ className }: Props) {
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  if (!lowPowerMode) return null;

  return (
    <span
      data-testid="low-power-indicator"
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
        'bg-accent-aqua/15 text-accent-aqua ring-1 ring-accent-aqua/30',
        className,
      )}
    >
      <BatteryLow className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
      Low power
    </span>
  );
}

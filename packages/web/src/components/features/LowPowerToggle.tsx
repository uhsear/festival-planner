import React from 'react';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';
import { BatteryLow } from 'lucide-react';
import { useHaptics } from '../../hooks/useHaptics';

interface Props {
  className?: string;
}

/**
 * Festival low-power mode toggle. Reads/writes the SHARED persisted flag
 * (`festivalModeStore.lowPowerMode`) so web + mobile stay in parity. When ON,
 * consumers gate the expensive, battery-hungry affordances (live-location
 * auto-share, ambient/looping schedule animations, aggressive auto-scroll) while
 * keeping the essentials (reminders, meeting pins, last-known data) working.
 *
 * Aqua-on switch (aqua = the single primary/selection accent); a small "Low
 * power" indicator surfaces elsewhere while active.
 */
export default function LowPowerToggle({ className }: Props) {
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  const toggleLowPowerMode = useFestivalModeStore((s) => s.toggleLowPowerMode);
  const { select } = useHaptics();

  const handleToggle = () => {
    select();
    toggleLowPowerMode();
  };

  return (
    <div className={`flex items-center gap-3 rounded-lg border border-border bg-bg-card p-3 ${className ?? ''}`}>
      <BatteryLow
        className={`w-5 h-5 shrink-0 ${lowPowerMode ? 'text-accent-aqua' : 'text-text-secondary'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p id="low-power-label" className="text-sm font-semibold text-text-primary">
          Festival low-power mode
        </p>
        <p id="low-power-desc" className="text-xs text-text-muted">
          Saves battery: pauses ambient animation and the live-location auto-share. Reminders and your crew plan keep
          working.
        </p>
      </div>
      <span className="inline-flex items-center justify-center min-h-11 min-w-11 shrink-0">
        <button
          type="button"
          role="switch"
          aria-checked={lowPowerMode}
          aria-labelledby="low-power-label"
          aria-describedby="low-power-desc"
          onClick={handleToggle}
          data-testid="low-power-toggle"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua ${
            lowPowerMode ? 'bg-accent-aqua' : 'bg-border-light'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
              lowPowerMode ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </span>
    </div>
  );
}

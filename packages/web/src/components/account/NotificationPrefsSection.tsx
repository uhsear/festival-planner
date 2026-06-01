import { useEffect } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useNotificationPrefsStore } from '@festie/shared/stores';
import { cn } from '../../lib/utils';

const QUIET_START = '23:00';
const QUIET_END = '08:00';

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="min-w-0">
        <div className="text-sm text-text-primary">{label}</div>
        {hint ? <div className="text-xs text-text-muted">{hint}</div> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent-aqua' : 'bg-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  );
}

/**
 * Per-category notification preferences (crew / set reminders / schedule) + a
 * quiet-hours toggle, backed by the shared notificationPrefs store
 * (GET/PUT /notifications/prefs). Web parity with the mobile
 * AccountNotificationPrefsSection. Quiet hours maps to the backend DND window.
 */
export default function NotificationPrefsSection() {
  const prefs = useNotificationPrefsStore((s) => s.prefs);
  const loadPrefs = useNotificationPrefsStore((s) => s.loadPrefs);
  const updatePrefs = useNotificationPrefsStore((s) => s.updatePrefs);

  useEffect(() => {
    loadPrefs().catch(() => {});
  }, [loadPrefs]);

  const quietOn = !!prefs.dndStart;

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border">
      <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        Notification types
      </h2>
      <Toggle
        label="Set reminders"
        checked={prefs.setReminders}
        onChange={(v) => updatePrefs({ setReminders: v }).catch(() => {})}
      />
      <Toggle
        label="Crew updates"
        checked={prefs.crewUpdates}
        onChange={(v) => updatePrefs({ crewUpdates: v }).catch(() => {})}
      />
      <Toggle
        label="Schedule changes"
        checked={prefs.scheduleChanges}
        onChange={(v) => updatePrefs({ scheduleChanges: v }).catch(() => {})}
      />
      <Toggle
        label="Quiet hours"
        hint="Mute 11pm–8am"
        checked={quietOn}
        onChange={(v) =>
          updatePrefs(v ? { dndStart: QUIET_START, dndEnd: QUIET_END } : { dndStart: null, dndEnd: null }).catch(
            () => {},
          )
        }
      />
    </section>
  );
}

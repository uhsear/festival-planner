import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useNotificationPrefsStore, useFestivalStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import { useToast } from '../../lib/toastContext';
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
      <span className="inline-flex items-center justify-center min-h-11 min-w-11 shrink-0">
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
      </span>
    </div>
  );
}

type TopicSubscriptions = { crew: boolean; schedule: boolean };

/**
 * Per-festival notification opt-out, scoped to the currently selected festival.
 * Toggling a topic OFF mutes that topic's push for this festival via
 * GET/PUT /notifications/topics/:festivalId (topics: crew, schedule). Defaults
 * to ON before load; the actual subscription state loads on mount. Renders
 * nothing until a current festival is selected.
 */
function FestivalTopicsSubsection() {
  const { toast } = useToast();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalId = currentFestival?.id ?? null;

  // Default to ON (subscribed) before the real state loads.
  const [subs, setSubs] = useState<TopicSubscriptions>({ crew: true, schedule: true });

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    api
      .get<TopicSubscriptions>(`/notifications/topics/${encodeURIComponent(festivalId)}`)
      .then((data) => {
        if (cancelled) return;
        setSubs({ crew: data.crew !== false, schedule: data.schedule !== false });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  if (!currentFestival || !festivalId) return null;

  const setTopic = (topic: keyof TopicSubscriptions, value: boolean) => {
    const prev = subs;
    setSubs((s) => ({ ...s, [topic]: value }));
    api.put(`/notifications/topics/${encodeURIComponent(festivalId)}`, { [topic]: value }).catch(() => {
      setSubs(prev);
      toast("Couldn't update notification setting. Try again.", 'error');
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <h3 className="text-xs font-medium text-text-muted mb-1">Notifications for {currentFestival.name}</h3>
      <Toggle label="Crew updates" checked={subs.crew} onChange={(v) => setTopic('crew', v)} />
      <Toggle label="Schedule changes" checked={subs.schedule} onChange={(v) => setTopic('schedule', v)} />
    </div>
  );
}

/**
 * Per-category notification preferences (crew / set reminders / schedule) + a
 * quiet-hours toggle, backed by the shared notificationPrefs store
 * (GET/PUT /notifications/prefs). Web parity with the mobile
 * AccountNotificationPrefsSection. Quiet hours maps to the backend DND window.
 * Followed by a per-festival topic opt-out scoped to the current festival.
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
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        Notification types
      </h3>
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
        label="New lineups"
        hint="A festival you've been to before posts its lineup"
        checked={prefs.lineupDrops}
        onChange={(v) => updatePrefs({ lineupDrops: v }).catch(() => {})}
      />
      <Toggle
        label="Crew re-forms"
        hint="A past crew reunites for a new festival"
        checked={prefs.crewReformed}
        onChange={(v) => updatePrefs({ crewReformed: v }).catch(() => {})}
      />
      <Toggle
        label="Wrap-up ready"
        hint="Your festival recap is ready to view"
        checked={prefs.wrapReady}
        onChange={(v) => updatePrefs({ wrapReady: v }).catch(() => {})}
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
      <FestivalTopicsSubsection />
    </section>
  );
}

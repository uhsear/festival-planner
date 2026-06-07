import { useEffect, useState } from 'react';
import { Download, Check, AlertCircle, CircleDashed, Loader } from 'lucide-react';
import { useOfflineReadinessStore } from '@festie/shared/stores/offlineReadinessStore';
import type { ReadinessSection, SectionReadiness } from '@festie/shared/stores/offlineReadinessStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { timeAgo } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

interface Props {
  festivalId: string;
  className?: string;
}

// Ordered checklist of the five downloadable sections + their labels.
const SECTIONS: Array<{ key: ReadinessSection; label: string }> = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'picks', label: 'My picks' },
  { key: 'crew', label: 'Crew plan' },
  { key: 'weather', label: 'Weather' },
  { key: 'art', label: 'Artist art' },
];

function SectionRow({ label, section, tick }: { label: string; section: SectionReadiness; tick: number }) {
  // `tick` is unused directly but its change forces a re-render so the
  // "synced N ago" label advances from the device clock without a network call.
  void tick;
  let icon: React.ReactNode;
  let text: string;
  let tone: string;

  switch (section.status) {
    case 'ready':
      icon = <Check className="w-4 h-4" aria-hidden="true" />;
      text = section.syncedAt != null ? `Ready · synced ${timeAgo(section.syncedAt)}` : 'Ready';
      tone = 'text-accent-aqua';
      break;
    case 'syncing':
      icon = <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />;
      text = 'Downloading…';
      tone = 'text-text-secondary';
      break;
    case 'error':
      icon = <AlertCircle className="w-4 h-4" aria-hidden="true" />;
      text = section.syncedAt != null ? `Couldn't refresh · synced ${timeAgo(section.syncedAt)}` : "Couldn't download";
      tone = 'text-accent-coral';
      break;
    default:
      icon = <CircleDashed className="w-4 h-4" aria-hidden="true" />;
      text = 'Not downloaded';
      tone = 'text-text-muted';
  }

  return (
    <li className="flex items-center gap-2.5 py-1.5 text-sm" role="status">
      <span className={cn('flex-shrink-0', tone)}>{icon}</span>
      <span className="font-medium text-text-primary">{label}</span>
      <span className={cn('ml-auto text-xs tabular-nums', tone)}>{text}</span>
    </li>
  );
}

/**
 * F5 "Download this festival for offline" surface. A single button that
 * orchestrates the existing loaders (schedule, picks, crew, weather, art) into
 * their persisted stores + the web service-worker cache, plus a per-section
 * readiness checklist that shows "Ready · synced N ago" / "Not downloaded".
 *
 * The "synced N ago" labels advance from the device clock via a 30s tick — the
 * same offline-honesty pattern as FreshnessChip — so the freshness stays honest
 * even on a cold offline launch.
 */
export default function OfflineReadinessCard({ festivalId, className }: Props) {
  const readiness = useOfflineReadinessStore((s) => s.byFestival[festivalId]);
  const downloadingFestivalId = useOfflineReadinessStore((s) => s.downloadingFestivalId);
  const downloadForOffline = useOfflineReadinessStore((s) => s.downloadForOffline);
  // Include the active crew so the crew plan downloads alongside the schedule.
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);

  const isDownloading = downloadingFestivalId === festivalId;

  // 30s tick so "synced N ago" keeps advancing from the device clock — no
  // network, the cardinal offline-honesty requirement (mirrors FreshnessChip).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const hasDownloaded = !!readiness && SECTIONS.some(({ key }) => readiness[key]?.status === 'ready');

  const handleDownload = () => {
    void downloadForOffline(festivalId, activeCrewId ?? undefined);
  };

  return (
    <section
      className={cn('rounded-xl border border-border bg-bg-card p-4', className)}
      aria-label="Download festival for offline"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Download for offline</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            Cache the schedule, your picks, your crew plan, weather, and artist art so they work with no signal at the
            festival.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          aria-busy={isDownloading || undefined}
          className={cn(
            'inline-flex flex-shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold min-h-11',
            'transition-[background-color,transform] duration-[var(--duration-med)] ease-[var(--ease-out)]',
            'bg-accent-aqua text-bg-primary hover:bg-[var(--color-accent-aqua-hover)] active:scale-[0.97] motion-reduce:transform-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {isDownloading ? (
            <Loader className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4" aria-hidden="true" />
          )}
          {isDownloading ? 'Downloading…' : hasDownloaded ? 'Update' : 'Download'}
        </button>
      </div>

      <ul className="mt-3 divide-y divide-border" aria-label="Offline readiness checklist">
        {SECTIONS.map(({ key, label }) => (
          <SectionRow
            key={key}
            label={label}
            section={readiness?.[key] ?? { status: 'idle', syncedAt: null }}
            tick={tick}
          />
        ))}
      </ul>
    </section>
  );
}

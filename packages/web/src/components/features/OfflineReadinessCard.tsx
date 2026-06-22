import { useEffect, useRef, useState } from 'react';
import { Check, AlertCircle, Download, RefreshCw } from 'lucide-react';
import { useOfflineReadinessStore } from '@festie/shared/stores/offlineReadinessStore';
import type { ReadinessSection, SectionReadiness } from '@festie/shared/stores/offlineReadinessStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { timeAgo } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

interface Props {
  festivalId: string;
  className?: string;
}

// Ordered step list — matches store section order (schedule must finish first).
const SECTIONS: Array<{ key: ReadinessSection; label: string }> = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'picks', label: 'My picks' },
  { key: 'crew', label: 'Crew plan' },
  { key: 'weather', label: 'Weather' },
  { key: 'art', label: 'Artist art' },
];

// R18: per-step state renderer.
// pending  -> 8px muted dot
// active   -> 8px aqua pulsing dot + shimmer placeholder label
// done     -> aqua check icon + "synced N ago"
// error    -> coral alert icon + label text + inline retry button
function StepRow({
  label,
  section,
  tick,
  onRetry,
}: {
  label: string;
  section: SectionReadiness;
  tick: number;
  onRetry?: () => void;
}) {
  // tick forces re-render so "synced N ago" advances from the device clock.
  void tick;

  const isPending = section.status === 'idle';
  const isActive = section.status === 'syncing';
  const isDone = section.status === 'ready';
  const isError = section.status === 'error';

  return (
    <li className="flex items-center gap-3 py-2" role="status">
      {/* Step indicator: pending dot / active pulse / done check / error icon */}
      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">
        {isDone ? (
          <Check className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4 text-accent-coral" aria-hidden="true" />
        ) : isActive ? (
          <span
            className="block w-2 h-2 rounded-full motion-reduce:opacity-60"
            style={{ background: '#00e8d0', animation: 'offline-step-pulse 900ms ease-in-out infinite' }}
            aria-hidden="true"
          />
        ) : (
          <span className="block w-2 h-2 rounded-full" style={{ background: '#3a3a3a' }} aria-hidden="true" />
        )}
      </span>

      {/* Step label */}
      <span
        className={cn(
          'text-sm font-medium flex-1',
          isDone && 'text-text-primary',
          isActive && 'text-text-secondary',
          isPending && 'text-text-muted',
          isError && 'text-accent-coral',
        )}
      >
        {label}
      </span>

      {/* Right-side: status text or retry */}
      <span className="ml-auto flex items-center gap-1.5 text-xs tabular-nums">
        {isDone && (
          <span className="text-accent-aqua">
            {section.syncedAt != null ? `synced ${timeAgo(section.syncedAt)}` : 'ready'}
          </span>
        )}
        {isActive && (
          /* Shimmer placeholder while downloading */
          <span
            className="skeleton-shimmer inline-block"
            aria-label="Downloading"
            style={{ width: 80, height: 10, borderRadius: 4 }}
          />
        )}
        {isError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-accent-coral hover:text-text-primary transition-colors focus-visible:outline-1 focus-visible:outline-accent-coral rounded"
            aria-label={`Retry ${label}`}
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Retry
          </button>
        )}
        {isError && !onRetry && (
          <span className="text-accent-coral">
            {section.syncedAt != null ? `failed · ${timeAgo(section.syncedAt)}` : 'failed'}
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * R18: Multi-step loader for the festival offline-download sync.
 *
 * Renders the five download sections (schedule / picks / crew / weather / art)
 * as a vertical step list with per-step state: pending dot, active shimmer,
 * done aqua check, error coral text + retry. Replaces the previous flat
 * spinner/icon rows. UI only — store orchestration is unchanged.
 *
 * The "synced N ago" labels advance from the device clock via a 30s tick —
 * same offline-honesty pattern as FreshnessChip.
 */
export default function OfflineReadinessCard({ festivalId, className }: Props) {
  const readiness = useOfflineReadinessStore((s) => s.byFestival[festivalId]);
  const downloadingFestivalId = useOfflineReadinessStore((s) => s.downloadingFestivalId);
  const downloadForOffline = useOfflineReadinessStore((s) => s.downloadForOffline);
  const activeCrewId = useCrewStore((s) => s.activeCrew?.id ?? null);

  const isDownloading = downloadingFestivalId === festivalId;

  // 30s tick so "synced N ago" keeps advancing from the device clock.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const hasDownloaded = !!readiness && SECTIONS.some(({ key }) => readiness[key]?.status === 'ready');

  // Inject the pulse keyframe once. Co-located with the only consumer.
  // prefers-reduced-motion variant collapses the animation.
  const keyframeInjected = useRef(false);
  useEffect(() => {
    if (keyframeInjected.current) return;
    keyframeInjected.current = true;
    const style = document.createElement('style');
    style.dataset.offlineStep = '1';
    style.textContent =
      '@keyframes offline-step-pulse{' +
      '0%,100%{opacity:1;transform:scale(1)}' +
      '50%{opacity:0.45;transform:scale(1.35)}' +
      '}' +
      '@media(prefers-reduced-motion:reduce){' +
      '@keyframes offline-step-pulse{from,to{opacity:0.7;transform:none}}' +
      '}';
    document.head.appendChild(style);
  }, []);

  const handleDownload = () => void downloadForOffline(festivalId, activeCrewId ?? undefined);
  // Per-step retry re-triggers the full download (store handles idempotency).
  const handleRetry = () => void downloadForOffline(festivalId, activeCrewId ?? undefined);

  return (
    <section
      className={cn('rounded-xl border border-border bg-bg-card p-4', className)}
      aria-label="Download festival for offline"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text-primary">Download for offline</h3>
          <p className="mt-0.5 text-xs text-text-secondary">
            Cache the schedule, picks, crew plan, weather, and art so they work with no signal.
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
          <Download className="w-4 h-4" aria-hidden="true" />
          {isDownloading ? 'Downloading…' : hasDownloaded ? 'Update' : 'Download'}
        </button>
      </div>

      {/* R18: vertical step list */}
      <ul className="mt-3 divide-y divide-[rgba(255,255,255,0.08)]" aria-label="Offline readiness checklist">
        {SECTIONS.map(({ key, label }) => {
          const sec = readiness?.[key] ?? { status: 'idle' as const, syncedAt: null };
          return (
            <StepRow
              key={key}
              label={label}
              section={sec}
              tick={tick}
              onRetry={sec.status === 'error' ? handleRetry : undefined}
            />
          );
        })}
      </ul>
    </section>
  );
}

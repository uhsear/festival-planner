import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
// html-to-image is dynamic-imported inside handleShare so it's not in the
// initial /wrap chunk — only fetched when the user taps Share.
import { api } from '@festie/shared/services';
import { useFestivalStore, useAuthStore, useCrewStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import GuestTeaser from '../components/features/GuestTeaser';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import Button from '../components/ui/Button';
import WrapPoster from '../components/features/WrapPoster';
import CrewWrapPoster, { type CrewWrapData } from '../components/features/CrewWrapPoster';
import { useToast } from '../lib/toastContext';
import { useAnimatedNumber } from '../hooks/useAnimatedNumber';
import { useRovingTabs } from '../hooks/useRovingTabs';
import { isFestivalOver } from '@festie/shared/utils';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Sparkles, Trophy, Map as MapIcon, Clock, CalendarDays, Share2, Users, DollarSign } from 'lucide-react';

// Server shape from GET /ratings/wrap/:festivalId:
//   { stats: { totalRated, stagesVisited, daysAttended, totalHours },
//     topSets:    [{ setId, rating, artist, stageId?, startTime?, ... }],
//     allRatings: [...] }
interface WrapStats {
  totalRated: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
  avgRating?: number | null;
}
interface TopSet {
  setId: string;
  rating: number;
  artist?: string;
  note?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  stageId?: string | null;
  stageName?: string | null;
}
interface WrapResponse {
  stats: WrapStats;
  topSets: TopSet[];
  allRatings: TopSet[];
}

const EMOJI: Record<number, string> = { 5: '🔥', 4: '😊', 3: '👍', 2: '🤔', 1: '👎' };

export default function WrapPage() {
  return (
    <RenderErrorBoundary name="wrap">
      <WrapPageInner />
    </RenderErrorBoundary>
  );
}

function WrapPageInner() {
  const user = useAuthStore((s) => s.user);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const { getStageName } = useFestival();
  const { toast } = useToast();
  const posterRef = useRef<HTMLDivElement>(null);
  const wrapTabsRef = useRef<HTMLDivElement>(null);
  useRovingTabs(wrapTabsRef);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'me' | 'crew'>('me');

  const over = isFestivalOver(currentFestival, days);

  const { data, isLoading, isError, refetch } = useQuery<WrapResponse>({
    queryKey: ['wrap', currentFestival?.id],
    queryFn: async () => {
      const res = await api.get<WrapResponse>(`/ratings/wrap/${currentFestival!.id}`);
      return res as WrapResponse;
    },
    enabled: !!currentFestival?.id && !!user && over,
  });

  const allSorted = useMemo(
    () =>
      (data?.allRatings || [])
        .slice()
        .sort((a, b) => b.rating - a.rating || (a.startTime || '').localeCompare(b.startTime || '')),
    [data?.allRatings],
  );

  // Memo for poster top-sets must live ABOVE early-return branches below —
  // React would otherwise call fewer hooks on error/loading renders and throw
  // "Rendered more hooks than during the previous render" (error #310).
  const posterTopSets = useMemo(
    () =>
      (data?.topSets || []).slice(0, 5).map((s) => ({
        rating: s.rating,
        artist: s.artist || s.setId,
        stageName: s.stageName || (s.stageId ? getStageName(s.stageId) : null),
      })),
    [data?.topSets, getStageName],
  );

  // Share-as-PNG — captures the fixed 1080×1920 off-screen WrapPoster,
  // passes to Web Share API if available, otherwise triggers a download.
  // Await document.fonts.ready so custom fonts (Syncopate) finish loading
  // before capture — avoids the iOS Safari font-race that renders fallback
  // glyphs into the PNG.
  const handleShare = useCallback(async () => {
    if (!posterRef.current || !currentFestival) return;
    setSharing(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(r));
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(posterRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 2,
        backgroundColor: '#080810',
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');
      const file = new File([blob], `festie-wrap-${currentFestival.id}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'My Festie Wrap' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
        a.click();
        URL.revokeObjectURL(url);
        toast('Saved to downloads', 'success');
      }
    } catch (e: unknown) {
      // AbortError = user cancelled share sheet; suppress.
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) {
        toast(e instanceof Error ? e.message : 'Share failed', 'error');
      }
    } finally {
      setSharing(false);
    }
  }, [currentFestival, toast]);

  if (!user) return <GuestTeaser mode="picks" />;

  if (!currentFestival) {
    return (
      <div className="max-w-lg mx-auto">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12" aria-hidden="true" />}
            title="Select a festival first"
            description="Your wrap appears here once a festival ends."
          />
        </Card>
      </div>
    );
  }

  if (!over) {
    return (
      <div className="max-w-lg mx-auto min-h-[calc(100vh-200px)] flex items-center justify-center">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12 text-accent-aqua" aria-hidden="true" />}
            title="Festival wrap coming soon"
            description="We'll put together your highlights the day after the festival ends."
          />
        </Card>
      </div>
    );
  }

  // Tab bar — Personal vs Crew wrap. Rendered above the personal-query
  // loading/error branches so the crew view is reachable regardless of the
  // personal wrap's fetch state.
  const tabBar = (
    <div className="max-w-lg mx-auto">
      <div
        ref={wrapTabsRef}
        role="tablist"
        aria-label="Wrap view"
        className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-bg-card border border-border"
      >
        <button
          role="tab"
          aria-selected={tab === 'me'}
          onClick={() => setTab('me')}
          className={`min-h-[40px] rounded-lg text-sm font-medium transition-colors ${
            tab === 'me' ? 'bg-accent-aqua text-bg-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          You
        </button>
        <button
          role="tab"
          aria-selected={tab === 'crew'}
          onClick={() => setTab('crew')}
          className={`min-h-[40px] rounded-lg text-sm font-medium transition-colors ${
            tab === 'crew' ? 'bg-accent-aqua text-bg-primary' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Crew wrap
        </button>
      </div>
    </div>
  );

  if (tab === 'crew') {
    return (
      <div>
        {tabBar}
        <CrewWrapTab
          crewId={activeCrew?.id ?? null}
          crewName={activeCrew?.name ?? 'Your crew'}
          festivalId={currentFestival.id}
          festivalName={currentFestival.name}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-3">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="max-w-lg mx-auto">
        <Card padding="lg">
          <EmptyState
            icon={<Sparkles className="w-12 h-12" aria-hidden="true" />}
            title="Couldn't load your wrap"
            description="Something went wrong loading your festival wrap."
            cta={{ label: 'Retry', onClick: () => refetch() }}
          />
        </Card>
      </div>
    );
  }

  const stats = data?.stats || { totalRated: 0, stagesVisited: 0, daysAttended: 0, totalHours: 0 };
  const topSets = data?.topSets || [];
  const totalHours = stats.totalHours ?? 0;

  return (
    <div>
      {tabBar}
      {/* max-w-lg + centered mirrors /account so the wrap doesn't stretch
          1400px wide on desktop (stats grid went 2-col × ~650px each before,
          reading as sparse placeholder chrome rather than a dense highlight page).
          No own top/side pad — the shell `px-6 py-4` owns it; the tab bar above
          already added the top band, so the body keeps just inter-section rhythm. */}
      <div className="max-w-lg mx-auto space-y-4 pt-4 pb-6">
        <header className="text-center space-y-1">
          <div className="inline-flex items-center gap-2 text-accent-aqua text-xs uppercase tracking-widest">
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            Your Festival Wrap
          </div>
          {/* h1 matches /account (font-display bold 2xl) — previously used
            font-extrabold w/ default sans, which visually broke from the
            rest of the app's display-font headings. */}
          <h1 className="text-xl font-display font-bold text-text-primary leading-tight">{currentFestival.name}</h1>
        </header>

        {/* R16: Bento grid — 2x2 with featured full-width headline stat.
            gap:1px rendered as aqua tint hairline via parent background. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gridTemplateRows: 'auto auto',
            gap: '1px',
            background: 'rgba(0,232,208,0.08)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          <div style={{ gridColumn: 'span 2' }}>
            <Stat
              icon={<Trophy className="w-4 h-4" aria-hidden="true" />}
              label="Sets rated"
              value={String(stats.totalRated)}
              featured
            />
          </div>
          <Stat
            icon={<MapIcon className="w-4 h-4" aria-hidden="true" />}
            label="Stages"
            value={String(stats.stagesVisited)}
          />
          <Stat
            icon={<CalendarDays className="w-4 h-4" aria-hidden="true" />}
            label="Days"
            value={String(stats.daysAttended)}
          />
          <Stat
            icon={<Clock className="w-4 h-4" aria-hidden="true" />}
            label="Hours of music"
            value={totalHours.toFixed(1)}
          />
        </div>

        {/* Top sets */}
        {topSets.length > 0 ? (
          <section>
            <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-secondary mb-3">
              <span className="w-2 h-2 rounded-full bg-accent-aqua" aria-hidden="true" />
              Your top picks
            </h2>
            <div className="space-y-3">
              {topSets.map((s, i) => (
                <div key={s.setId} className="flex items-center gap-3 p-4 rounded-xl bg-bg-card border border-border">
                  <div className="text-3xl flex-shrink-0" aria-hidden="true">
                    {EMOJI[s.rating]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-muted">
                      #{i + 1} · {s.stageName || (s.stageId ? getStageName(s.stageId) : 'Stage')}
                    </div>
                    <div className="font-semibold text-text-primary truncate">{s.artist || s.setId}</div>
                    {s.note && <div className="text-xs text-text-secondary mt-0.5 italic truncate">"{s.note}"</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <Card padding="lg">
            <EmptyState
              icon={<Trophy className="w-12 h-12" aria-hidden="true" />}
              title="No 4/5 or 5/5 ratings yet"
              description="Rate sets from the set detail panel to build your wrap."
            />
          </Card>
        )}

        {/* Full list */}
        {allSorted.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-secondary mb-3">
              <span className="w-2 h-2 rounded-full bg-accent-coral" aria-hidden="true" />
              Everything you rated
            </h2>
            <div className="rounded-xl bg-bg-card border border-border p-4">
              {allSorted.map((s) => (
                <div
                  key={s.setId}
                  className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 first:pt-0 last:pb-0"
                >
                  <span className="text-lg" aria-hidden="true">
                    {EMOJI[s.rating]}
                  </span>
                  <span className="flex-1 text-sm text-text-primary truncate">{s.artist || s.setId}</span>
                  {(s.stageName || s.stageId) && (
                    <span className="text-xs text-text-muted">{s.stageName || getStageName(s.stageId!)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Share button — only meaningful when there's at least one rated set */}
        {stats.totalRated > 0 && (
          <div className="pt-2">
            <Button variant="primary" fullWidth isLoading={sharing} onClick={handleShare} className="min-h-[44px]">
              <Share2 className="w-4 h-4" aria-hidden="true" />
              Share your wrap
            </Button>
          </div>
        )}

        <div className="pt-4 text-center text-xs text-text-muted">festie.us</div>

        {/* Off-screen poster for export. position: fixed + negative left keeps
          it in the document (so fonts/layouts resolve) but invisible. Guarded
          by stats.totalRated > 0 to avoid rendering an empty poster. */}
        {stats.totalRated > 0 && (
          <div
            aria-hidden="true"
            className="fixed -left-[99999px] top-0 w-[1080px] h-[1920px] pointer-events-none overflow-hidden"
          >
            <div ref={posterRef}>
              <WrapPoster
                festivalName={currentFestival.name}
                topSets={posterTopSets}
                stats={{
                  totalRated: stats.totalRated,
                  stagesVisited: stats.stagesVisited,
                  daysAttended: stats.daysAttended,
                  totalHours,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CrewWrapResponse {
  wrap: CrewWrapData;
}

// Crew wrap tab — fetches GET /ratings/crew-wrap/:crewId/:festivalId and renders
// the shared recap, reusing the same off-screen-poster + html-to-image + Web
// Share pipeline as the personal wrap (incl. the document.fonts.ready guard).
function CrewWrapTab({
  crewId,
  crewName,
  festivalId,
  festivalName,
}: {
  crewId: string | null;
  crewName: string;
  festivalId: string;
  festivalName: string;
}) {
  const { toast } = useToast();
  const posterRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery<CrewWrapResponse>({
    queryKey: ['crew-wrap', crewId, festivalId],
    queryFn: async () => api.get<CrewWrapResponse>(`/ratings/crew-wrap/${crewId}/${festivalId}`),
    enabled: !!crewId,
  });

  const wrap = data?.wrap;

  const handleShare = useCallback(async () => {
    if (!posterRef.current) return;
    setSharing(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(r));
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(posterRef.current, {
        width: 1080,
        height: 1920,
        pixelRatio: 2,
        backgroundColor: '#080810',
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');
      const file = new File([blob], `festie-crew-wrap-${crewId}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Our Festie Crew Wrap' });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
        a.click();
        URL.revokeObjectURL(url);
        toast('Saved to downloads', 'success');
      }
    } catch (e: unknown) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) toast(e instanceof Error ? e.message : 'Share failed', 'error');
    } finally {
      setSharing(false);
    }
  }, [crewId, toast]);

  if (!crewId) {
    return (
      <div className="max-w-lg mx-auto pt-4">
        <Card padding="lg">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title="No active crew"
            description="Join or select a crew to see your shared festival recap."
          />
        </Card>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto pt-4 space-y-3">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }
  if (isError || !wrap) {
    return (
      <div className="max-w-lg mx-auto pt-4">
        <Card padding="lg">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title="Couldn't load your crew wrap"
            description="Something went wrong loading the shared recap."
            cta={{ label: 'Retry', onClick: () => refetch() }}
          />
        </Card>
      </div>
    );
  }

  const hasData =
    wrap.memberCount > 0 && (wrap.topOverlap !== null || wrap.setsSeenTogether.length > 0 || wrap.totalSplit > 0);

  return (
    <div className="max-w-lg mx-auto space-y-4 pt-4 pb-6">
      <header className="text-center space-y-1">
        <div className="inline-flex items-center gap-2 text-accent-aqua text-xs uppercase tracking-widest">
          <Users className="w-4 h-4" aria-hidden="true" />
          Crew Wrap
        </div>
        <h1 className="text-xl font-display font-bold text-text-primary leading-tight">{crewName}</h1>
        <p className="text-sm text-text-secondary">{festivalName}</p>
      </header>

      {/* R16: Crew hub stats — 3-cell horizontal bento with aqua hairline dividers. */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0' }}
      >
        <Stat
          icon={<Users className="w-4 h-4" aria-hidden="true" />}
          label="Crew"
          value={String(wrap.memberCount)}
          dividerRight
        />
        <Stat
          icon={<Trophy className="w-4 h-4" aria-hidden="true" />}
          label="Seen together"
          value={String(wrap.setsSeenTogether.length)}
          dividerRight
        />
        <Stat
          icon={<DollarSign className="w-4 h-4" aria-hidden="true" />}
          label="Split"
          value={wrap.totalSplit.toLocaleString(undefined, {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
          })}
        />
      </div>

      {/* Superlatives */}
      <section className="space-y-3">
        <Superlative
          label="Most-overlapping taste"
          value={wrap.topOverlap ? `${wrap.topOverlap.aName} + ${wrap.topOverlap.bName}` : 'Rate more sets together'}
          sub={
            wrap.topOverlap
              ? `${wrap.topOverlap.shared} shared favourite${wrap.topOverlap.shared === 1 ? '' : 's'}` +
                (wrap.topOverlap.sharedSets.length ? ` · ${wrap.topOverlap.sharedSets.slice(0, 3).join(', ')}` : '')
              : undefined
          }
        />
        <Superlative
          label="Biggest spender"
          value={wrap.biggestSpender ? wrap.biggestSpender.name : 'No expenses yet'}
          sub={
            wrap.biggestSpender
              ? `fronted ${wrap.biggestSpender.amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}`
              : undefined
          }
        />
      </section>

      {/* Sets seen together */}
      {wrap.setsSeenTogether.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-secondary mb-3">
            <span className="w-2 h-2 rounded-full bg-accent-aqua" aria-hidden="true" />
            Sets you saw together
          </h2>
          <div className="rounded-xl bg-bg-card border border-border p-4 space-y-2">
            {wrap.setsSeenTogether.slice(0, 10).map((s) => (
              <div key={s.setId} className="flex items-center gap-3">
                <span className="flex-1 text-sm text-text-primary truncate">{s.artist || s.setId}</span>
                <span className="text-xs font-semibold text-accent-aqua">{s.count} loved it</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Per-member top picks */}
      {wrap.perMember.some((m) => m.topSets.length > 0) && (
        <section>
          <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-text-secondary mb-3">
            <span className="w-2 h-2 rounded-full bg-accent-coral" aria-hidden="true" />
            Everyone's top picks
          </h2>
          <div className="space-y-3">
            {wrap.perMember.map((m) => (
              <div key={m.userId} className="rounded-xl bg-bg-card border border-border p-4">
                <div className="text-sm font-semibold text-text-primary mb-1">{m.name}</div>
                {m.topSets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {m.topSets.map((s) => (
                      <span
                        key={s.setId}
                        className="text-xs px-2 py-1 rounded-full bg-bg-secondary border border-border text-text-secondary"
                      >
                        {EMOJI[s.rating]} {s.artist || s.setId}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-text-muted">No 4★+ sets yet</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Share button — meaningful only with at least some crew data */}
      {hasData && (
        <div className="pt-2">
          <Button variant="primary" fullWidth isLoading={sharing} onClick={handleShare} className="min-h-[44px]">
            <Share2 className="w-4 h-4" aria-hidden="true" />
            Share crew wrap
          </Button>
        </div>
      )}

      <div className="pt-4 text-center text-xs text-text-muted">festie.us</div>

      {/* Off-screen poster for export — guarded by hasData to avoid an empty card. */}
      {hasData && (
        <div
          aria-hidden="true"
          className="fixed -left-[99999px] top-0 w-[1080px] h-[1920px] pointer-events-none overflow-hidden"
        >
          <div ref={posterRef}>
            <CrewWrapPoster crewName={crewName} festivalName={festivalName} wrap={wrap} />
          </div>
        </div>
      )}
    </div>
  );
}

function Superlative({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-bg-card border border-border p-4">
      <div className="text-xs uppercase tracking-widest text-text-muted">{label}</div>
      <div className="text-base font-bold text-text-primary mt-1">{value}</div>
      {sub && <div className="text-xs text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

// R10 / N1: animates from 0 to `target` on mount (or when value changes) via
// the shared useAnimatedNumber tween. Float detection: if `target` contains
// '.' the display uses one decimal. Non-numeric targets (e.g. the
// currency-formatted "Split" stat) render as-is, no tween.
function useCountUp(target: string, duration = 800): string {
  const numericTarget = parseFloat(target);
  const isNumeric = !Number.isNaN(numericTarget);
  const animated = useAnimatedNumber(isNumeric ? numericTarget : 0, {
    duration,
    decimals: target.includes('.') ? 1 : 0,
    startFrom: 0,
  });
  return isNumeric ? animated : target;
}

// R10 + R16: count-up on Wrap stat numbers; bento-aware layout.
// featured -> Syncopate display scale (text-4xl, tracking-tight).
// dividerRight -> aqua hairline on right edge for crew 3-cell bento.
function Stat({
  icon,
  label,
  value,
  featured = false,
  dividerRight = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  featured?: boolean;
  dividerRight?: boolean;
}) {
  const animated = useCountUp(value, 800);
  return (
    <div
      className="flex flex-col gap-1 p-5 bg-bg-card"
      style={dividerRight ? { borderRight: '1px solid rgba(0,232,208,0.12)' } : undefined}
    >
      {icon ? (
        <div className="flex items-center gap-1.5 text-xs text-text-muted uppercase tracking-wide">
          {icon}
          <span>{label}</span>
        </div>
      ) : (
        <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
      )}
      <div
        className={
          featured
            ? 'font-bold font-display text-text-primary text-4xl tracking-[-0.02em]'
            : 'text-xl font-bold font-display text-text-primary'
        }
        aria-label={value}
      >
        {animated}
      </div>
    </div>
  );
}

import React, { useMemo, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
// html-to-image is dynamic-imported inside handleShare so it's not in the
// initial /wrap chunk — only fetched when the user taps Share.
import { api } from '@festie/shared/services';
import { useFestivalStore, useAuthStore } from '@festie/shared/stores';
import { useFestival } from '@festie/shared/hooks';
import GuestTeaser from '../components/features/GuestTeaser';
import EmptyState from '../components/ui/EmptyState';
import Skeleton from '../components/ui/Skeleton';
import Button from '../components/ui/Button';
import WrapPoster from '../components/features/WrapPoster';
import { useToast } from '../lib/toastContext';
import { isFestivalOver } from '@festie/shared/utils';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Sparkles, Trophy, Map as MapIcon, Clock, CalendarDays, Share2 } from 'lucide-react';

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
interface WrapResponse { stats: WrapStats; topSets: TopSet[]; allRatings: TopSet[] }

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
  const { getStageName } = useFestival();
  const { toast } = useToast();
  const posterRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  const over = isFestivalOver(currentFestival, days);

  const { data, isLoading, isError, refetch } = useQuery<WrapResponse>({
    queryKey: ['wrap', currentFestival?.id],
    queryFn: async () => {
      const res = await api.get<WrapResponse>(`/ratings/wrap/${currentFestival!.id}`);
      return res as WrapResponse;
    },
    enabled: !!currentFestival?.id && !!user && over,
  });

  const allSorted = useMemo(() => (data?.allRatings || []).slice().sort((a, b) => b.rating - a.rating || (a.startTime || '').localeCompare(b.startTime || '')), [data?.allRatings]);

  // Memo for poster top-sets must live ABOVE early-return branches below —
  // React would otherwise call fewer hooks on error/loading renders and throw
  // "Rendered more hooks than during the previous render" (error #310).
  const posterTopSets = useMemo(
    () => (data?.topSets || []).slice(0, 5).map((s) => ({
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
      <div className="px-4 py-8">
        <EmptyState icon={<Sparkles className="w-12 h-12" aria-hidden="true" />} title="Select a festival first"
          description="Your wrap appears here once a festival ends." />
      </div>
    );
  }

  if (!over) {
    return (
      <div className="px-4 py-8">
        <EmptyState icon={<Sparkles className="w-12 h-12" aria-hidden="true" />} title="Festival wrap coming soon"
          description="We'll put together your highlights the day after the festival ends." />
      </div>
    );
  }

  if (isLoading) {
    return <div className="px-4 py-6 space-y-3"><Skeleton variant="card" /><Skeleton variant="card" /><Skeleton variant="card" /></div>;
  }
  if (isError) {
    return <div className="px-4 py-8"><EmptyState icon={<Sparkles className="w-12 h-12" aria-hidden="true" />} title="Couldn't load your wrap" description="Something went wrong loading your festival wrap." cta={{ label: 'Retry', onClick: () => refetch() }} /></div>;
  }

  const stats = data?.stats || { totalRated: 0, stagesVisited: 0, daysAttended: 0, totalHours: 0 };
  const topSets = data?.topSets || [];
  const totalHours = stats.totalHours ?? 0;

  return (
    // max-w-lg + centered mirrors /account so the wrap doesn't stretch
    // 1400px wide on desktop (stats grid went 2-col × ~650px each before,
    // reading as sparse placeholder chrome rather than a dense highlight page).
    <div className="max-w-lg mx-auto space-y-4 px-4 pt-4 pb-6">
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

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 max-[319px]:grid-cols-1">
        <Stat icon={<Trophy className="w-4 h-4" aria-hidden="true" />} label="Sets rated" value={String(stats.totalRated)} />
        <Stat icon={<MapIcon className="w-4 h-4" aria-hidden="true" />} label="Stages visited" value={String(stats.stagesVisited)} />
        <Stat icon={<CalendarDays className="w-4 h-4" aria-hidden="true" />} label="Days attended" value={String(stats.daysAttended)} />
        <Stat icon={<Clock className="w-4 h-4" aria-hidden="true" />} label="Hours of music" value={totalHours.toFixed(1)} />
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
                <div className="text-3xl flex-shrink-0" aria-hidden="true">{EMOJI[s.rating]}</div>
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
        <EmptyState icon={<Trophy className="w-12 h-12" aria-hidden="true" />}
          title="No 4/5 or 5/5 ratings yet"
          description="Rate sets from the set detail panel to build your wrap." />
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
              <div key={s.setId} className="flex items-center gap-3 py-2 border-b border-border last:border-b-0 first:pt-0 last:pb-0">
                <span className="text-lg" aria-hidden="true">{EMOJI[s.rating]}</span>
                <span className="flex-1 text-sm text-text-primary truncate">{s.artist || s.setId}</span>
                {(s.stageName || s.stageId) && <span className="text-xs text-text-muted">{s.stageName || getStageName(s.stageId!)}</span>}
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
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl bg-bg-card border border-border">
      <div className="flex items-center gap-1.5 text-xs text-text-muted uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-xl font-bold text-text-primary">{value}</div>
    </div>
  );
}

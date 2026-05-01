import React, { useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { useSetStatus } from '@/hooks/useSetStatus';
import { artistDisplayName } from '@festie/shared/utils';
import { cn } from '@/lib/utils';

interface NowPlayingBarProps {
  liveSets: FestivalSet[];
  myPicks: Record<string, Priority>;
  onSetTap: (set: FestivalSet) => void;
}

export default function NowPlayingBar({ liveSets, myPicks, onSetTap }: NowPlayingBarProps) {
  const prefersReducedMotion = useReducedMotion();
  const statuses = useSetStatus(liveSets);
  const statusArray = Array.isArray(statuses) ? statuses : [statuses];

  // Find the first "live" set that's in my picks
  const liveMyPick = useMemo(() => {
    return liveSets.find((set, idx) => {
      const status = Array.isArray(statuses) ? statuses[idx] : statuses;
      return status.status === 'live' && myPicks[set.id] === 'must';
    });
  }, [liveSets, statuses, myPicks]);

  // Get status info for the featured set or fallback info
  const featuredSet = liveMyPick || liveSets[0];
  const featuredIdx = liveSets.findIndex((s) => s.id === featuredSet?.id);
  const featuredStatus = statusArray[featuredIdx] || statusArray[0];

  // If no live sets at all, don't show the bar
  if (!featuredSet || !featuredStatus || featuredStatus.status !== 'live') {
    return null;
  }

  const artistName = artistDisplayName(featuredSet);
  const liveCount = statusArray.filter((s) => s.status === 'live').length;

  return (
    <AnimatePresence>
      <motion.div
        role="status"
        aria-live="polite"
        aria-label={liveMyPick ? `Now playing: ${artistName}` : `${liveCount} set${liveCount !== 1 ? 's' : ''} live now`}
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 100 }}
        className="fixed bottom-20 left-4 right-4 z-40"
      >
        <button
          onClick={() => onSetTap(featuredSet)}
          className={cn(
            'w-full text-left p-4 rounded-xl transition-all',
            'bg-glass border border-border-light',
            'hover:border-accent-aqua/50 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]',
          )}
        >
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                {liveMyPick ? (
                  <>
                    <div className="text-xs font-medium text-accent-coral uppercase tracking-wider">
                      Now Playing
                    </div>
                    <div className="text-sm font-bold text-text-primary truncate">{artistName}</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-medium text-accent-amber uppercase tracking-wider">
                      Happening Now
                    </div>
                    <div className="text-sm font-bold text-text-primary">
                      {liveCount} set{liveCount !== 1 ? 's' : ''} live
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1">
                {prefersReducedMotion ? (
                  <div className="w-2 h-2 rounded-full bg-accent-coral" aria-hidden="true" />
                ) : (
                  <motion.div
                    className="w-2 h-2 rounded-full bg-accent-coral"
                    aria-hidden="true"
                    animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1 bg-bg-card/50 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-accent-coral to-accent-amber"
                initial={{ width: '0%' }}
                animate={{ width: `${Math.round(featuredStatus.progress * 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

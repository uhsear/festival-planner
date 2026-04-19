import React from 'react';
import { motion } from 'motion/react';
import { X, ArrowRightLeft } from 'lucide-react';
import { FestivalSet, Priority } from '@festie/shared/types';
import { formatTime, artistDisplayName } from '@festie/shared/utils';
import { cn } from '@/lib/utils';
import CrewOverlapHeat from './CrewOverlapHeat';

interface ConflictCompareProps {
  setA: FestivalSet;
  setB: FestivalSet;
  onClose: () => void;
  onSwitchPriority: (setId: string, priority: Priority | null) => void;
  crewSize?: number;
  crewPicksA?: number;
  crewPicksB?: number;
}

/**
 * ConflictCompare: Split-screen conflict comparison panel
 * Shows two conflicting sets side by side for easy comparison
 * Allows quick priority switching
 */
export default function ConflictCompare({
  setA,
  setB,
  onClose,
  onSwitchPriority,
  crewSize = 0,
  crewPicksA = 0,
  crewPicksB = 0,
}: ConflictCompareProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />

      {/* Panel */}
      <motion.div
        className="relative z-10 w-full max-w-2xl bg-card glass rounded-2xl overflow-hidden"
        layoutId="conflict-compare"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close comparison"
          className="absolute top-4 right-4 z-20 p-2 hover:bg-bg-secondary rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-text-secondary" />
        </button>

        {/* Header */}
        <div className="bg-bg-secondary/50 px-6 py-4 border-b border-color-border">
          <h2 className="text-lg font-semibold text-text-primary">
            Schedule Conflict
          </h2>
          <p className="text-sm text-text-secondary mt-1">
            These sets overlap. Pick your priority.
          </p>
        </div>

        {/* Content */}
        <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Set A */}
          <ComparisonSetCard
            set={setA}
            crewPicks={crewPicksA}
            crewSize={crewSize}
            onSwitchPriority={onSwitchPriority}
          />

          {/* VS divider */}
          <div className="hidden sm:flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto rounded-full bg-accent-coral/20 flex items-center justify-center mb-2">
                <span className="text-xs font-bold text-accent-coral">VS</span>
              </div>
              <div className="w-1 h-12 bg-color-border rounded-full" />
            </div>
          </div>

          {/* Set B */}
          <ComparisonSetCard
            set={setB}
            crewPicks={crewPicksB}
            crewSize={crewSize}
            onSwitchPriority={onSwitchPriority}
          />
        </div>

        {/* Footer info */}
        <div className="bg-bg-secondary/30 px-6 py-3 border-t border-color-border text-xs text-text-secondary text-center">
          Tap on a set to change its priority
        </div>
      </motion.div>
    </motion.div>
  );
}

interface ComparisonSetCardProps {
  set: FestivalSet;
  crewPicks: number;
  crewSize: number;
  onSwitchPriority: (setId: string, priority: Priority | null) => void;
}

/**
 * Internal component: Single set comparison card
 */
function ComparisonSetCard({
  set,
  crewPicks,
  crewSize,
  onSwitchPriority,
}: ComparisonSetCardProps) {
  const [showPriorityMenu, setShowPriorityMenu] = React.useState(false);

  const handlePrioritySelect = (priority: Priority | null) => {
    onSwitchPriority(set.id, priority);
    setShowPriorityMenu(false);
  };

  return (
    <motion.div
      className="bg-bg-secondary/50 rounded-xl p-4 border border-color-border hover:border-accent-aqua/50 transition-colors"
      whileHover={{ y: -2 }}
    >
      {/* Artist */}
      <h3 className="font-semibold text-text-primary truncate text-sm">
        {set.artist || 'Unknown Artist'}
      </h3>

      {/* Stage and time */}
      <div className="mt-2 space-y-1 text-xs text-text-secondary">
        {set.stageName && <p>Stage: {set.stageName}</p>}
        {set.startTime && set.endTime && (
          <p>
            {formatTime(set.startTime)} — {formatTime(set.endTime)}
          </p>
        )}
      </div>

      {/* Crew overlap */}
      {crewSize > 0 && (
        <div className="mt-3 pt-3 border-t border-color-border">
          <CrewOverlapHeat
            crewSize={crewSize}
            overlapCount={crewPicks}
          />
        </div>
      )}

      {/* Priority button */}
      <div className="mt-4 relative">
        <motion.button
          onClick={() => setShowPriorityMenu(!showPriorityMenu)}
          whileTap={{ scale: 0.95 }}
          className={cn(
            'w-full py-2 px-3 rounded-lg text-xs font-semibold transition-all duration-200',
            'bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span>Switch Priority</span>
            <ArrowRightLeft className="w-3 h-3" />
          </div>
        </motion.button>

        {/* Priority menu */}
        {showPriorityMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute top-full mt-2 left-0 right-0 bg-card border border-color-border rounded-lg overflow-hidden z-10"
          >
            {(['must', 'want-to-see', 'maybe', null] as const).map((priority) => (
              <button
                key={priority || 'clear'}
                onClick={() => handlePrioritySelect(priority)}
                className="w-full px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-secondary transition-colors text-left"
              >
                {priority
                  ? priority === 'must'
                    ? '🔴 Must See'
                    : priority === 'want-to-see'
                      ? '🟡 Want to See'
                      : '⚪ Maybe'
                  : '✕ Clear'}
              </button>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

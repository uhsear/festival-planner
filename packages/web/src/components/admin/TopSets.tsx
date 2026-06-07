import React from 'react';

interface TopSet {
  artist: string;
  pickCount: number;
}

export interface TopSetsProps {
  sets: TopSet[];
  maxPicks?: number;
}

export default function TopSets({ sets, maxPicks }: TopSetsProps) {
  if (sets.length === 0) return null;

  const max = maxPicks ?? sets.reduce((m, s) => Math.max(m, s.pickCount), 1);

  return (
    <div>
      <h2 className="type-heading text-text-primary mb-4">Top Picked Sets</h2>
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
        {sets.slice(0, 15).map((s, i) => (
          <div key={`${s.artist}-${i}`} className="flex items-center gap-3">
            <div className="text-sm font-bold text-text-muted min-w-6">{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary mb-1 truncate">{s.artist}</div>
              <div className="h-2 rounded-full bg-bg-primary/30 overflow-hidden">
                <div
                  style={{ transform: `scaleX(${max > 0 ? s.pickCount / max : 0})` }}
                  className="h-full w-full origin-left bg-gradient-to-r from-accent-aqua to-accent-coral transition-transform duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
                />
              </div>
            </div>
            <div className="text-sm font-medium text-text-muted min-w-12 text-right">{s.pickCount}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

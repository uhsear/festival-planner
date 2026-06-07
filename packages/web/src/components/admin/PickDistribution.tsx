import React from 'react';

export interface PickDistributionProps {
  must: number;
  want: number;
  maybe: number;
}

export default function PickDistribution({ must, want, maybe }: PickDistributionProps) {
  const total = must + want + maybe;
  const mustPercent = total > 0 ? (must / total) * 100 : 0;
  const wantPercent = total > 0 ? (want / total) * 100 : 0;
  const maybePercent = total > 0 ? (maybe / total) * 100 : 0;

  return (
    <div>
      <h2 className="type-heading text-text-primary mb-4">Pick Distribution</h2>
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div>
            <div className="text-sm text-text-muted mb-2">Must See</div>
            <div className="text-3xl font-bold text-accent-coral">{must}</div>
            <div className="text-xs text-text-muted mt-1">{mustPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-sm text-text-muted mb-2">Want to See</div>
            <div className="text-3xl font-bold text-accent-aqua">{want}</div>
            <div className="text-xs text-text-muted mt-1">{wantPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-sm text-text-muted mb-2">Maybe</div>
            <div className="text-3xl font-bold text-accent-amber">{maybe}</div>
            <div className="text-xs text-text-muted mt-1">{maybePercent.toFixed(1)}%</div>
          </div>
        </div>
        {/* Bar chart */}
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden bg-bg-primary/20">
          {mustPercent > 0 && (
            <div
              style={{ flex: mustPercent }}
              className="bg-accent-coral transition-[flex-grow] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
              title={`Must: ${mustPercent.toFixed(1)}%`}
            />
          )}
          {wantPercent > 0 && (
            <div
              style={{ flex: wantPercent }}
              className="bg-accent-aqua transition-[flex-grow] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
              title={`Want: ${wantPercent.toFixed(1)}%`}
            />
          )}
          {maybePercent > 0 && (
            <div
              style={{ flex: maybePercent }}
              className="bg-accent-amber transition-[flex-grow] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
              title={`Maybe: ${maybePercent.toFixed(1)}%`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

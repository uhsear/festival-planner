import { useNavigate } from '@tanstack/react-router';
import { Star, Users, Zap, Sparkles, type LucideIcon } from 'lucide-react';
import type { FestivalPhase } from '@festie/shared/utils';
import { cn } from '../../lib/utils';

type ActionKey = 'picks' | 'crew' | 'nownext' | 'wrap';
type RoutePath = '/picks' | '/crew' | '/festival-mode' | '/wrap';

interface ActionDef {
  key: ActionKey;
  label: string;
  Icon: LucideIcon;
  to: RoutePath;
  a11y: string;
}

// Fixed destination set — phase only reorders + re-emphasizes, never hides. The
// live map / SOS / meeting points live inside /crew on web, so Crew stays high
// in the live ordering rather than being buried under planning shortcuts.
const ACTIONS: Record<ActionKey, ActionDef> = {
  picks: { key: 'picks', label: 'My picks', Icon: Star, to: '/picks', a11y: 'Go to my picks' },
  crew: { key: 'crew', label: 'Crew', Icon: Users, to: '/crew', a11y: 'Go to crew' },
  nownext: { key: 'nownext', label: 'Now & Next', Icon: Zap, to: '/festival-mode', a11y: 'Open Now and Next' },
  wrap: { key: 'wrap', label: 'Festival wrap', Icon: Sparkles, to: '/wrap', a11y: 'Open festival wrap-up' },
};

// Per-phase ordering — the first entry is the emphasized (primary) action
// (Coachella phased-content model: re-prioritize per phase, never hide).
const PHASE_ORDER: Record<FestivalPhase, ActionKey[]> = {
  pre: ['picks', 'crew', 'nownext', 'wrap'],
  live: ['nownext', 'crew', 'picks', 'wrap'],
  post: ['wrap', 'crew', 'picks', 'nownext'],
};

const PHASE_HEADING: Record<FestivalPhase, { label: string; hint: string }> = {
  pre: { label: 'Before the festival', hint: 'Lock in your picks and rally your crew.' },
  live: { label: 'Happening now', hint: 'Check Now & Next, find your crew, stay safe.' },
  post: { label: 'Festival wrap', hint: 'Relive it and settle up with your crew.' },
};

interface PhaseHomeActionsProps {
  phase: FestivalPhase;
}

/**
 * P1-5 — phase-aware home actions for the web landing (`/`). Mirrors the mobile
 * PhaseHomeActions band: re-prioritizes the crew's destinations by festival
 * PHASE (derived from the date range vs now via shared `festivalPhase`) — pre
 * leads with picks/crew, live leads with Now & Next + crew (live map / SOS live
 * inside /crew), post leads with wrap + settle-up. The destination set is fixed;
 * phase only reorders and emphasizes the lead, so nothing is ever hidden.
 */
export default function PhaseHomeActions({ phase }: PhaseHomeActionsProps) {
  const navigate = useNavigate();
  const order = PHASE_ORDER[phase];
  const heading = PHASE_HEADING[phase];

  return (
    <section
      className="mb-[var(--space-4)] flex flex-col gap-[var(--space-2)]"
      aria-label={`${heading.label} — quick actions`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{heading.label}</span>
        <span className="text-xs text-text-secondary">{heading.hint}</span>
      </div>
      <div className="flex flex-wrap gap-[var(--space-2)]" role="group" aria-label="Phase actions">
        {order.map((key, i) => {
          const a = ACTIONS[key];
          const primary = i === 0;
          const { Icon } = a;
          return (
            <button
              key={key}
              type="button"
              data-testid={`phase-action-${key}`}
              onClick={() => navigate({ to: a.to })}
              aria-label={a.a11y}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold',
                'min-h-[44px] cursor-pointer border-2 transition-colors duration-200',
                'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2',
                primary
                  ? 'border-accent-aqua bg-[var(--color-aqua-a08)] text-accent-aqua'
                  : 'border-border text-text-secondary hover:text-text-primary',
              )}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {a.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

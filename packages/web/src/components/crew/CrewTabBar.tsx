import React from 'react';
import { Users, MapPin, BarChart3, Backpack, DollarSign, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabKey = 'members' | 'meeting' | 'polls' | 'packing' | 'expenses' | 'activity';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'members', label: 'Members', icon: <Users className="w-4 h-4" aria-hidden="true" /> },
  { key: 'meeting', label: 'Meet', icon: <MapPin className="w-4 h-4" aria-hidden="true" /> },
  { key: 'polls', label: 'Polls', icon: <BarChart3 className="w-4 h-4" aria-hidden="true" /> },
  { key: 'packing', label: 'Packing', icon: <Backpack className="w-4 h-4" aria-hidden="true" /> },
  { key: 'expenses', label: 'Expenses', icon: <DollarSign className="w-4 h-4" aria-hidden="true" /> },
  { key: 'activity', label: 'Activity', icon: <Activity className="w-4 h-4" aria-hidden="true" /> },
];

interface CrewTabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  /**
   * Per-tab badge content rendered after the label. A number renders a small
   * count pill; `true` renders a dot indicator. Falsy values render nothing.
   */
  badges?: Partial<Record<TabKey, number | boolean>>;
}

export default function CrewTabBar({ activeTab, onTabChange, badges }: CrewTabBarProps) {
  return (
    <div
      className="flex gap-1 overflow-x-auto px-3 scrollbar-hide min-w-0 max-w-full snap-x snap-mandatory [scroll-padding-inline:0.75rem] [mask-image:linear-gradient(to_right,transparent,black_0.75rem,black_calc(100%-0.75rem),transparent)]"
      role="tablist"
      aria-label="Crew tabs"
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={activeTab === t.key}
          id={`crew-tab-${t.key}`}
          aria-controls="crew-tab-panel"
          onClick={() => onTabChange(t.key)}
          className={cn(
            'flex-shrink-0 snap-start px-2.5 py-1.5 min-h-11 rounded-md flex items-center gap-1 text-xs font-medium whitespace-nowrap',
            'transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.97] motion-reduce:active:!transform-none',
            activeTab === t.key
              ? 'bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/30'
              : 'bg-bg-card text-text-secondary border border-border hover:border-border-light',
          )}
        >
          {t.icon}
          {t.label}
          {(() => {
            const badge = badges?.[t.key];
            if (typeof badge === 'number' && badge > 0) {
              return (
                <span
                  className="ml-0.5 min-w-4 px-1 py-px rounded-full bg-accent-coral/20 text-accent-coral text-[10px] font-semibold leading-none text-center"
                  aria-label={`${badge} open`}
                >
                  {badge}
                </span>
              );
            }
            if (badge === true) {
              return (
                <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-accent-coral" aria-label="Unsettled balance" />
              );
            }
            return null;
          })()}
        </button>
      ))}
    </div>
  );
}

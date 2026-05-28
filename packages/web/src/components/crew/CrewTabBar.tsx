import React from 'react';
import {
  Users, MapPin, BarChart3, DollarSign, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabKey = 'members' | 'meeting' | 'polls' | 'expenses' | 'activity';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'members',  label: 'Members',  icon: <Users       className="w-4 h-4" aria-hidden="true" /> },
  { key: 'meeting',  label: 'Meet',     icon: <MapPin      className="w-4 h-4" aria-hidden="true" /> },
  { key: 'polls',    label: 'Polls',    icon: <BarChart3   className="w-4 h-4" aria-hidden="true" /> },
  { key: 'expenses', label: 'Expenses', icon: <DollarSign  className="w-4 h-4" aria-hidden="true" /> },
  { key: 'activity', label: 'Activity', icon: <Activity    className="w-4 h-4" aria-hidden="true" /> },
];

interface CrewTabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export default function CrewTabBar({ activeTab, onTabChange }: CrewTabBarProps) {
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
        </button>
      ))}
    </div>
  );
}

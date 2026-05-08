import React from 'react';
import {
  Users, MapPin, BarChart3, DollarSign, Activity,
} from 'lucide-react';

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
      className="flex gap-1 overflow-x-auto -mx-1 px-1 pr-4 scrollbar-hide min-w-0 max-w-full"
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
          className={`flex-shrink-0 px-2.5 py-1.5 min-h-11 rounded-md flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-colors ${
            activeTab === t.key
              ? 'bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/30'
              : 'bg-bg-card text-text-secondary border border-border hover:border-border-light'
          }`}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

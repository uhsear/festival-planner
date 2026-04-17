import React, { useMemo } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';

interface NavTab {
  label: string;
  href: string;
  icon: React.ReactNode;
}

/** Schedule icon — matches legacy createSvgIcon('cards') */
const ScheduleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

/** Timeline icon — matches legacy createSvgIcon('timeline') */
const TimelineIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 6h16" />
    <path d="M4 12h10" />
    <path d="M4 18h14" />
  </svg>
);

/** Grid icon — matches legacy createSvgIcon('grid') */
const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="3" width="5" height="5" />
    <rect x="10" y="3" width="5" height="5" />
    <rect x="17" y="3" width="5" height="5" />
    <rect x="3" y="10" width="5" height="5" />
    <rect x="10" y="10" width="5" height="5" />
    <rect x="17" y="10" width="5" height="5" />
    <rect x="3" y="17" width="5" height="5" />
    <rect x="10" y="17" width="5" height="5" />
    <rect x="17" y="17" width="5" height="5" />
  </svg>
);

/** Picks icon — star */
const PicksIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

/** Crew icon — people */
const CrewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const baseTabs: NavTab[] = [
  { label: 'Schedule', href: '/cards', icon: <ScheduleIcon /> },
  { label: 'Timeline', href: '/timeline', icon: <TimelineIcon /> },
  { label: 'Grid', href: '/grid', icon: <GridIcon /> },
];

const authTabs: NavTab[] = [
  { label: 'My Picks', href: '/picks', icon: <PicksIcon /> },
  { label: 'Crew', href: '/crew', icon: <CrewIcon /> },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);

  // Show picks/crew tabs when user is logged in. They'll render their own
  // empty state if the user hasn't joined the festival yet. This is more
  // reliable than gating on currentProfile, which depends on a timing-
  // sensitive chain of API calls that can leave the tabs missing on reload.
  const tabs = useMemo(() => {
    if (user) {
      return [...baseTabs, ...authTabs];
    }
    return baseTabs;
  }, [user]);

  const isActive = (href: string) => {
    if (href === '/cards') return location.pathname === '/' || location.pathname === '/cards';
    return location.pathname === href;
  };

  return (
    <footer className="bottom-nav" role="contentinfo">
      <div className="bottom-nav-inner" role="tablist" aria-label="Main navigation">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <button
              key={tab.href}
              role="tab"
              aria-selected={active}
              aria-controls="main-content"
              tabIndex={active ? 0 : -1}
              aria-label={`View ${tab.label}`}
              className={active ? 'active' : ''}
              onClick={() => navigate({ to: tab.href })}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}

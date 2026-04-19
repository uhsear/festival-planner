import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useFestivalStore, useAuthStore } from '@festie/shared';
import FestivalSelector from './FestivalSelector';
import UserMenu from './UserMenu';
import FestivalModeToggle from '../features/FestivalModeToggle';

export default function Header() {
  const [showSearch, setShowSearch] = useState(false);
  const searchQuery = useFestivalStore((state) => state.searchQuery);
  const setSearchQuery = useFestivalStore((state) => state.setSearchQuery);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const navigate = useNavigate();

  // Desktop nav tabs — show picks/crew when logged in. Those views render
  // their own empty state if the user hasn't joined the festival yet.
  // Gating on user (instead of currentProfile) avoids races where the tabs
  // disappear on reload before profiles have finished loading.
  const desktopTabs = useMemo(() => {
    const base = [
      { label: 'Schedule', href: '/cards' },
      { label: 'Timeline', href: '/timeline' },
      { label: 'Grid', href: '/grid' },
    ];
    if (user) {
      base.push(
        { label: 'My Picks', href: '/picks' },
        { label: 'Crew', href: '/crew' },
      );
    }
    return base;
  }, [user]);

  const isTabActive = (href: string) => {
    if (href === '/cards') return location.pathname === '/' || location.pathname === '/cards';
    return location.pathname === href;
  };

  // Theme toggle — reads/writes localStorage like legacy app
  const [theme, setThemeState] = useState<string>(() =>
    localStorage.getItem('fp-theme') || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('fp-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Connection status — simplified for React rewrite
  const [connected] = useState(true);

  // Capture the `beforeinstallprompt` event so the Install App button can
  // actually trigger the PWA install flow. Browsers fire this once when
  // the PWA is installable; we stash it on window for the click handler.
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      window.__festieInstallPrompt = e as BeforeInstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return (
    <header className="header">
      {/* Left section: connection dot + brand + util strip */}
      <div className="header-left">
        <div
          className={`conn-status ${connected ? 'connected' : 'disconnected'}`}
          role="status"
          aria-label={connected ? 'Connected' : 'Disconnected'}
        />
        <div className="header-brand">
          <h1 className="logo">
            <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
              FESTIE
            </a>
          </h1>
          <div className="header-util-strip">
            {/* Install App button */}
            <button
              className="util-btn util-install"
              type="button"
              data-testid="install-app-btn"
              onClick={async () => {
                const evt = window.__festieInstallPrompt;
                if (!evt) return;
                try {
                  await evt.prompt();
                  await evt.userChoice;
                } catch {
                  /* user dismissed or prompt already consumed */
                }
                window.__festieInstallPrompt = null;
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              {' Install App'}
            </button>

            {/* Support link */}
            <a
              className="util-btn util-support"
              href="https://paypal.me/uhsear"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {' Support Me'}
            </a>
          </div>
        </div>

        {/* Desktop navigation tabs — hidden on mobile via CSS (.desktop-nav) */}
        <div className="desktop-nav" role="tablist" aria-label="View navigation">
          {desktopTabs.map((tab) => {
            const active = isTabActive(tab.href);
            return (
              <button
                key={tab.href}
                role="tab"
                aria-selected={active}
                aria-controls="main-content"
                tabIndex={active ? 0 : -1}
                className={active ? 'active' : ''}
                onClick={() => navigate({ to: tab.href })}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right section: festival mode + theme toggle + admin badge + profile badge */}
      <div className="header-right">
        {/* Festival Mode toggle — flips store flag + navigates to /festival-mode */}
        <FestivalModeToggle />

        {/* Theme toggle */}
        <button
          className="btn btn-ghost btn-sm theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle light/dark theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <span aria-hidden="true">{theme === 'dark' ? '\u2600' : '\uD83C\uDF19'}</span>
        </button>

        {/* User menu / profile badge */}
        {user && <UserMenu user={user} />}
      </div>
    </header>
  );
}

import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface AdminLayoutProps {
  title: string;
  description?: string;
  onTabChange: (tab: string) => void;
  activeTab: string;
  tabs: Array<{ id: string; label: string; icon?: React.ReactNode }>;
  children: React.ReactNode;
}

/**
 * Admin panel layout with tabs and navigation
 */
export default function AdminLayout({ title, description, onTabChange, activeTab, tabs, children }: AdminLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-dvh bg-bg-primary">
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-glass-border bg-bg-card/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 py-4 md:px-6">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate({ to: '/cards' })}
              className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-md text-text-secondary hover:text-text-primary transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
              aria-label="Back to app"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </button>
            <div>
              <h1 className="type-heading text-text-primary">{title}</h1>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
          </div>
        </div>

        {/* Mobile tabs — horizontally scrollable tab strip. The previous
            hamburger toggle set state that was never rendered; removed. */}
        <div className="admin-mobile-only overflow-x-auto border-t border-glass-border">
          <div className="flex gap-1 px-4 py-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  activeTab === tab.id
                    ? 'bg-accent-aqua text-bg-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <nav className="admin-desktop-sidebar border-r border-glass-border bg-bg-card/40">
          <div className="p-4 space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 text-left px-3 py-2.5 rounded-lg transition-colors',
                  'font-medium text-sm [&_svg]:w-4 [&_svg]:h-4 [&_svg]:flex-shrink-0',
                  activeTab === tab.id
                    ? 'bg-accent-aqua text-bg-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-primary/20',
                )}
              >
                {tab.icon && (
                  <span className="inline-flex" aria-hidden="true">
                    {tab.icon}
                  </span>
                )}
                {tab.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Content area — <section> rather than <main> because AppShell's
            #main-content is already the page's <main>. Using two main
            landmarks violates `landmark-no-duplicate-main`. */}
        <section className="flex-1 overflow-y-auto" aria-label="Admin content">
          <div className="px-4 py-6 md:px-6 max-w-6xl mx-auto">{children}</div>
        </section>
      </div>
    </div>
  );
}

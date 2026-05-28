import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SubHeader from './SubHeader';

// Minimal store state used by SubHeader. Selectors are applied against this.
const storeState = {
  festivals: [{ id: 'f1', name: 'Festival One' }],
  currentFestival: { id: 'f1', name: 'Festival One' },
  selectFestival: vi.fn(),
  stages: [{ id: 's1', name: 'Main Stage' }],
  days: [
    { id: 'd1', label: 'Fri', date: '2026-05-29' },
    { id: 'd2', label: 'Sat', date: '2026-05-30' },
  ],
  selectedDay: 0,
  activeStages: [] as string[],
  searchQuery: '',
  setSelectedDay: vi.fn(),
  setActiveStages: vi.fn(),
  setSearchQuery: vi.fn(),
};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: () => ({ getStageColor: () => '#00e8d0' }),
}));

vi.mock('../../hooks/useSwipeDays', () => ({
  useSwipeDays: () => ({ bind: () => ({}) }),
}));

vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: () => ({ select: vi.fn() }),
}));

vi.mock('../../hooks/useScrollFade', () => ({
  useScrollFade: () => ({ ref: { current: null }, canScrollLeft: false, canScrollRight: false }),
}));

function getNav() {
  return document.querySelector('nav.sub-header') as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SubHeader layout density', () => {
  it('renders the festival selector and view controls nav', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByTestId('festival-select')).toBeInTheDocument();
    expect(getNav()).toBeInTheDocument();
  });

  it('applies compact horizontal rhythm on small widths and comfortable on desktop', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const nav = getNav();
    // Compact (mobile-first) defaults use the space-3 token.
    expect(nav.className).toContain('px-[var(--space-3)]');
    expect(nav.className).toContain('gap-[var(--space-3)]');
    // Comfortable desktop overrides behind the sm: breakpoint.
    expect(nav.className).toContain('sm:px-6');
    expect(nav.className).toContain('sm:gap-[var(--space-6)]');
  });

  it('keeps day tabs visible with consistent space-3 gap', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    const tabs = screen.getByRole('tablist', { name: 'Festival days' });
    expect(tabs.className).toContain('gap-[var(--space-3)]');
    expect(screen.getByRole('tab', { name: 'Fri' })).toBeInTheDocument();
  });

  it('hides day tabs and search when festivalOnly is set (behavior preserved)', () => {
    render(<SubHeader dayOnly={true} festivalOnly={true} />);
    expect(screen.queryByRole('tablist', { name: 'Festival days' })).not.toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('shows search box only when not dayOnly/festivalOnly', () => {
    render(<SubHeader dayOnly={false} festivalOnly={false} />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });
});

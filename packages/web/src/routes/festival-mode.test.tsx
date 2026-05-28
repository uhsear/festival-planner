import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector({})),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => selector({})),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: vi.fn(() => ({
    getStageName: vi.fn(() => 'Main Stage'),
  })),
}));

vi.mock('@festie/shared/utils', () => ({
  artistDisplayName: vi.fn((set: { artist?: string }) => set.artist || 'Unknown'),
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({
    title,
    description,
    cta,
  }: {
    title: string;
    description?: string;
    cta?: { label: string; onClick: () => void };
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {cta && (
        <button
          type="button"
          data-testid="fm-empty-pick-cta"
          onClick={cta.onClick}
        >
          {cta.label}
        </button>
      )}
    </div>
  ),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('lucide-react', () => ({
  CalendarX: () => <span data-testid="calendar-x-icon" />,
  SkipForward: () => <span data-testid="skip-forward-icon" />,
  Music: () => <span data-testid="music-icon" />,
  Star: () => <span data-testid="star-icon" />,
}));

import FestivalModeView from './festival-mode';
import { useFestivalStore } from '@festie/shared/stores';
import { useUIStore } from '@festie/shared/stores/uiStore';

// Helper to set up store mocks
function mockStores(overrides: {
  currentFestival?: { id: string; name: string; b2bSeparator?: string } | null;
  sets?: Array<{
    id: string;
    artist: string;
    stageId: string;
    startTime?: string;
    endTime?: string;
    date?: string;
    dayIndex?: number;
  }>;
  days?: Array<{ date: string; label: string }>;
  currentProfile?: { picks: Record<string, string> } | null;
} = {}) {
  const state = {
    currentFestival: overrides.currentFestival ?? null,
    sets: overrides.sets ?? [],
    days: overrides.days ?? [],
    currentProfile: overrides.currentProfile ?? null,
    setDetailSet: vi.fn(),
  };

  vi.mocked(useFestivalStore).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) => selector(state as unknown as Record<string, unknown>),
  );
  vi.mocked(useUIStore).mockImplementation(
    (selector: (s: Record<string, unknown>) => unknown) => selector(state as unknown as Record<string, unknown>),
  );

  return state;
}

describe('FestivalModeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pin the wall clock so Now/Up Next computation is deterministic and not
    // dependent on the real time the suite happens to run. Fixed-time/empty
    // picks => no current and no upcoming sets, so the empty-pick CTA branch
    // renders reliably.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T17:00:00'));
    mockStores();
  });

  afterEach(() => {
    // Restore real timers so we don't leak fake timers into other test files.
    vi.useRealTimers();
  });

  it('renders empty state when no festival loaded', () => {
    mockStores({ currentFestival: null });
    render(<FestivalModeView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No festival loaded')).toBeInTheDocument();
    expect(screen.getByText(/Pick a festival from the top menu/)).toBeInTheDocument();
  });

  it('renders festival name and time when festival is loaded', () => {
    mockStores({
      currentFestival: { id: 'f1', name: 'Bonnaroo 2026' },
      currentProfile: { picks: {} },
    });
    render(<FestivalModeView />);
    expect(screen.getByText('Bonnaroo 2026')).toBeInTheDocument();
  });

  it('renders NOW and UP NEXT sections when festival is loaded', () => {
    mockStores({
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      currentProfile: { picks: {} },
    });
    render(<FestivalModeView />);
    expect(screen.getByText('NOW')).toBeInTheDocument();
    expect(screen.getByText('UP NEXT')).toBeInTheDocument();
  });

  it('shows "Nothing playing right now" when no current sets', () => {
    mockStores({
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      currentProfile: { picks: {} },
      sets: [],
    });
    render(<FestivalModeView />);
    expect(screen.getByText(/Nothing playing right now/)).toBeInTheDocument();
  });

  it('shows "Browse the lineup" CTA when no picks at all', () => {
    mockStores({
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      currentProfile: { picks: {} },
      sets: [],
    });
    render(<FestivalModeView />);
    const cta = screen.getByTestId('fm-empty-pick-cta');
    expect(cta).toBeInTheDocument();
    // The CTA label is exactly "Browse the lineup" (the description also
    // contains the phrase, so scope the assertion to the button itself).
    expect(cta).toHaveTextContent('Browse the lineup');
  });

  it('renders the festival-mode-view container', () => {
    mockStores({
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      currentProfile: { picks: {} },
    });
    render(<FestivalModeView />);
    expect(screen.getByTestId('festival-mode-view')).toBeInTheDocument();
  });

  it('shows current time with aria-label', () => {
    mockStores({
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      currentProfile: { picks: {} },
    });
    render(<FestivalModeView />);
    expect(screen.getByLabelText('Current time')).toBeInTheDocument();
  });
});

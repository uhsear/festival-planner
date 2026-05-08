import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// Track store state that selectors read from
const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('@festie/shared/hooks', () => ({
  usePicks: vi.fn(() => ({
    getMyPick: vi.fn(() => null),
    savePick: vi.fn(),
    getMyNote: vi.fn(() => ''),
  })),
  useFestival: vi.fn(() => ({
    getStageColor: vi.fn(() => '#ccc'),
    getStageName: vi.fn(() => 'Main Stage'),
  })),
}));

vi.mock('@festie/shared/utils', () => ({
  formatTime: vi.fn((t: string) => t),
  artistDisplayName: vi.fn((set: { artist?: string }) => set.artist || 'Unknown'),
}));

vi.mock('../components/ui/StageBadge', () => ({
  default: ({ stageName }: { stageName: string }) => <span data-testid="stage-badge">{stageName}</span>,
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({ title, description, cta }: { title: string; description?: string; cta?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {cta && <button onClick={cta.onClick}>{cta.label}</button>}
    </div>
  ),
}));

vi.mock('../components/layout/RefreshableView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="refreshable-view">{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Star: () => <span data-testid="star-icon" />,
}));

import PicksView from './picks';
import { usePicks } from '@festie/shared/hooks';

function setStoreState(overrides: Record<string, unknown> = {}) {
  // Clear and repopulate the shared state object
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    user: { id: 'u1', username: 'testuser' },
    currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined },
    currentProfile: { picks: {} },
    sets: [],
    days: [{ date: '2026-06-10', label: 'Day 1' }],
    selectedDay: 0,
    setDetailSet: vi.fn(),
    ...overrides,
  });
}

describe('PicksView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it('renders nothing when no user', () => {
    setStoreState({ user: null });
    const { container } = render(<PicksView />);
    // Component returns null for unauthenticated users (redirect via useEffect)
    expect(container.firstChild).toBeNull();
  });

  it('shows "Select a festival first" when no festival', () => {
    setStoreState({ currentFestival: null });
    render(<PicksView />);
    expect(screen.getByText('Select a festival first.')).toBeInTheDocument();
  });

  it('shows "Join this festival" when no profile', () => {
    setStoreState({ currentProfile: null });
    render(<PicksView />);
    expect(screen.getByText('Join this festival to start saving picks.')).toBeInTheDocument();
  });

  it('shows empty state when user has zero picks for the day', () => {
    setStoreState();
    render(<PicksView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText(/No picks yet/)).toBeInTheDocument();
  });

  it('shows "Browse Artists" CTA in empty state', () => {
    setStoreState();
    render(<PicksView />);
    expect(screen.getByText('Browse Artists')).toBeInTheDocument();
  });

  it('renders pick sections when user has picks', () => {
    const sets = [
      { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 },
      { id: 's2', artist: 'Odesza', stageId: 'st2', startTime: '16:00', dayIndex: 0 },
    ];
    setStoreState({ sets });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn((id: string) => {
        if (id === 's1') return 'must';
        if (id === 's2') return 'maybe';
        return null;
      }),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    render(<PicksView />);
    expect(screen.getByText('Must See')).toBeInTheDocument();
    expect(screen.getByText('Want to See')).toBeInTheDocument();
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('renders pick items with artist names', () => {
    const sets = [
      { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', dayIndex: 0 },
    ];
    setStoreState({ sets });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn(() => 'must'),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
    render(<PicksView />);
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('renders the region with aria-label "My picks"', () => {
    render(<PicksView />);
    expect(screen.getByRole('region', { name: 'My picks' })).toBeInTheDocument();
  });
});

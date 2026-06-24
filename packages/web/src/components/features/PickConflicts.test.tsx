import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConflictGroup } from '@festie/shared/utils';

// Track store state that selectors read from.
const festivalState: Record<string, unknown> = {};
const crewState: Record<string, unknown> = {};
const uiState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));

vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(uiState)),
}));

vi.mock('@festie/shared/hooks', () => ({
  useFestival: vi.fn(() => ({
    getStageName: vi.fn((id: string) => (id === 'st1' ? 'Main Stage' : 'Sahara')),
    getStageColor: vi.fn(() => '#00e8d0'),
  })),
}));

// buildPickConflicts is the pure shared util; mock it at the boundary so each
// test drives the rendered output deterministically. Pass through the other
// utils the component imports.
const buildPickConflicts = vi.fn<() => ConflictGroup[]>(() => []);
vi.mock('@festie/shared/utils', () => ({
  buildPickConflicts: (...args: unknown[]) => buildPickConflicts(...(args as [])),
  artistDisplayName: vi.fn((set: { artist?: string }) => set.artist || 'Unknown'),
  formatTime: vi.fn((t: string) => t),
  resolveStageColor: (c: string | null | undefined, fallback: string) => c || fallback,
}));

vi.mock('../ui/StageBadge', () => ({
  default: ({ stageName }: { stageName: string }) => <span data-testid="stage-badge">{stageName}</span>,
}));

vi.mock('lucide-react', () => ({
  CalendarClock: () => <span data-testid="calendar-clock-icon" />,
  TriangleAlert: () => <span data-testid="triangle-alert-icon" />,
}));

import PickConflicts from './PickConflicts';

function makeSet(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    festivalId: 'f1',
    stageId: 'st1',
    artist: `Artist ${id}`,
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function setState() {
  Object.keys(festivalState).forEach((k) => delete festivalState[k]);
  Object.assign(festivalState, {
    sets: [makeSet('s1'), makeSet('s2', { artist: 'Odesza', startTime: '14:30', endTime: '15:30' })],
    days: [{ date: '2026-06-10', label: 'Day 1' }],
    selectedDay: 0,
    currentProfile: { userId: 'u1', picks: { s1: 'must', s2: 'want-to-see' } },
    currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined, timeZone: 'UTC' },
    allProfiles: [],
  });
  Object.keys(crewState).forEach((k) => delete crewState[k]);
  Object.assign(crewState, { activeCrew: null, crewMembers: [] });
  Object.keys(uiState).forEach((k) => delete uiState[k]);
  Object.assign(uiState, { setDetailSet: vi.fn() });
}

describe('PickConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildPickConflicts.mockReturnValue([]);
    setState();
  });

  it('renders nothing when there are no conflict groups', () => {
    buildPickConflicts.mockReturnValue([]);
    const { container } = render(<PickConflicts />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a clash card when two picks overlap', () => {
    const group: ConflictGroup = {
      picks: [
        {
          set: makeSet('s1') as never,
          priority: 'must',
          startMs: 0,
          endMs: 3_600_000,
          durationMin: 60,
        },
        {
          set: makeSet('s2', { artist: 'Odesza', startTime: '14:30', endTime: '15:30' }) as never,
          priority: 'want-to-see',
          startMs: 1_800_000,
          endMs: 5_400_000,
          durationMin: 60,
        },
      ],
      recommendedKeepId: 's1',
      overlapMin: 30,
    };
    buildPickConflicts.mockReturnValue([group]);

    render(<PickConflicts />);
    expect(screen.getByText('Schedule clash')).toBeInTheDocument();
    expect(screen.getByText(/30m overlap/)).toBeInTheDocument();
    expect(screen.getByText('Artist s1')).toBeInTheDocument();
    expect(screen.getByText('Odesza')).toBeInTheDocument();
    // Recommended keep is marked.
    expect(screen.getByText('Keep')).toBeInTheDocument();
    // Two-act clash → split hint.
    expect(screen.getByText(/Catch the first/)).toBeInTheDocument();
  });

  it('opens the set detail when "View set" is clicked', async () => {
    const user = userEvent.setup();
    const setDetailSet = vi.fn();
    uiState.setDetailSet = setDetailSet;
    const group: ConflictGroup = {
      picks: [
        { set: makeSet('s1') as never, priority: 'must', startMs: 0, endMs: 3_600_000, durationMin: 60 },
        {
          set: makeSet('s2', { artist: 'Odesza' }) as never,
          priority: 'want-to-see',
          startMs: 1_800_000,
          endMs: 5_400_000,
          durationMin: 60,
        },
      ],
      recommendedKeepId: 's1',
      overlapMin: 30,
    };
    buildPickConflicts.mockReturnValue([group]);

    render(<PickConflicts />);
    await user.click(screen.getByLabelText('Open details for Artist s1'));
    expect(setDetailSet).toHaveBeenCalledTimes(1);
  });
});

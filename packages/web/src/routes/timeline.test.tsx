import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock dependencies
const storeState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

vi.mock('@festie/shared/hooks', () => ({
  usePicks: vi.fn(() => ({
    getMyPick: vi.fn(() => null),
    getOtherPicks: vi.fn(() => []),
    savePick: vi.fn(),
  })),
  useFestival: vi.fn(() => ({
    getStageColor: vi.fn(() => '#ccc'),
    getStageName: vi.fn(() => 'Main Stage'),
  })),
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('../components/layout/RefreshableView', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="refreshable-view">{children}</div>,
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../features/TimelineGrid', () => ({
  default: () => <div data-testid="timeline-grid" />,
}));

vi.mock('../components/timeline/TBASection', () => ({
  default: () => <div data-testid="tba-section" />,
}));

vi.mock('../components/timeline/TimelineLegend', () => ({
  default: () => <div data-testid="timeline-legend" />,
}));

// Mock the custom hooks used by TimelineViewInner
const mockTimelineFilters = {
  currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined },
  stages: [{ id: 'st1', name: 'Main Stage' }],
  selectedDay: 0,
  visibleStages: [{ id: 'st1', name: 'Main Stage' }],
  allDaySets: [],
  timedSets: [],
  timelessSets: [],
  conflictIds: new Set<string>(),
  timeBounds: null,
};

vi.mock('../hooks/useTimelineFilters', () => ({
  useTimelineFilters: vi.fn(() => mockTimelineFilters),
}));

vi.mock('../hooks/useTimelineViewport', () => ({
  useTimelineViewport: vi.fn(() => ({ vpW: 1024, vpH: 900, rowHeight: 36 })),
}));

vi.mock('../hooks/useNowIndicator', () => ({
  useNowIndicator: vi.fn(() => ({
    nowIndicator: null,
    gridRef: { current: null },
    scrollToNow: vi.fn(),
  })),
}));

vi.mock('lucide-react', () => ({
  CalendarX: () => <span data-testid="calendar-x-icon" />,
  Music: () => <span data-testid="music-icon" />,
  Filter: () => <span data-testid="filter-icon" />,
}));

import TimelineView from './timeline';
import { useTimelineFilters } from '../hooks/useTimelineFilters';
import { useNowIndicator } from '../hooks/useNowIndicator';

function setFilters(overrides: Partial<typeof mockTimelineFilters> = {}) {
  const merged = { ...mockTimelineFilters, ...overrides };
  vi.mocked(useTimelineFilters).mockReturnValue(merged);
  return merged;
}

describe('TimelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFilters();
    vi.mocked(useNowIndicator).mockReturnValue({
      nowIndicator: null,
      gridRef: { current: null },
      scrollToNow: vi.fn(),
    });
  });

  it('renders without crashing', () => {
    const { container } = render(<TimelineView />);
    expect(container).toBeTruthy();
  });

  it('shows "No festival loaded" when no festival is selected', () => {
    setFilters({ currentFestival: null });
    render(<TimelineView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No festival loaded')).toBeInTheDocument();
    expect(screen.getByText('Choose a festival from the top menu to see the timeline.')).toBeInTheDocument();
  });

  it('shows TBA section when only timeless sets exist', () => {
    setFilters({
      timedSets: [],
      timelessSets: [{ id: 's1', artist: 'TBA Artist', stageId: 'st1', dayIndex: 0 }],
    });
    render(<TimelineView />);
    expect(screen.getByTestId('tba-section')).toBeInTheDocument();
  });

  it('shows "No sets scheduled" when allDaySets is empty and no timeless sets', () => {
    setFilters({
      allDaySets: [],
      timedSets: [],
      timelessSets: [],
      timeBounds: null,
    });
    render(<TimelineView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No sets scheduled for this day')).toBeInTheDocument();
  });

  it('shows "No sets scheduled" when timeBounds is null', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', dayIndex: 0 }],
      timedSets: [],
      timelessSets: [],
      timeBounds: null,
    });
    render(<TimelineView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No sets scheduled for this day')).toBeInTheDocument();
  });

  it('shows "All stages are filtered out" when no visible stages', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timedSets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [],
      visibleStages: [],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    render(<TimelineView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('All stages are filtered out')).toBeInTheDocument();
  });

  it('renders timeline grid when timed sets and visible stages exist', () => {
    setFilters({
      allDaySets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
      ],
      timedSets: [{ id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [],
      visibleStages: [{ id: 'st1', name: 'Main Stage' }],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    render(<TimelineView />);
    expect(screen.getByTestId('timeline-grid')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-legend')).toBeInTheDocument();
  });

  it('renders timeline region with correct aria-label', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timedSets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [],
      visibleStages: [{ id: 'st1', name: 'Main Stage' }],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    render(<TimelineView />);
    expect(screen.getByRole('region', { name: 'Timeline view' })).toBeInTheDocument();
  });

  it('shows "Now" button when nowIndicator is present', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timedSets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [],
      visibleStages: [{ id: 'st1', name: 'Main Stage' }],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    vi.mocked(useNowIndicator).mockReturnValue({
      nowIndicator: 50,
      gridRef: { current: null },
      scrollToNow: vi.fn(),
    });
    render(<TimelineView />);
    expect(screen.getByLabelText('Scroll to current time')).toBeInTheDocument();
    expect(screen.getByText('Now')).toBeInTheDocument();
  });

  it('does not show "Now" button when nowIndicator is null', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timedSets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [],
      visibleStages: [{ id: 'st1', name: 'Main Stage' }],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    render(<TimelineView />);
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });

  it('renders TBA section alongside timeline grid when timeless sets exist', () => {
    setFilters({
      allDaySets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
        { id: 's2', artist: 'TBA Artist', stageId: 'st1', dayIndex: 0 },
      ],
      timedSets: [{ id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [{ id: 's2', artist: 'TBA Artist', stageId: 'st1', dayIndex: 0 }],
      visibleStages: [{ id: 'st1', name: 'Main Stage' }],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    render(<TimelineView />);
    expect(screen.getByTestId('timeline-grid')).toBeInTheDocument();
    expect(screen.getByTestId('tba-section')).toBeInTheDocument();
  });

  it('wraps content in RefreshableView', () => {
    setFilters({
      allDaySets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timedSets: [{ id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 }],
      timelessSets: [],
      visibleStages: [{ id: 'st1', name: 'Main Stage' }],
      timeBounds: { minMin: 840, maxMin: 900, totalSlots: 4 },
    });
    render(<TimelineView />);
    expect(screen.getByTestId('refreshable-view')).toBeInTheDocument();
  });

  describe('Live mode — next-pick countdown', () => {
    // A set the device clock places 45 minutes in the future, on the same local
    // calendar day so getSetTimeBounds resolves it via set.date (no festival-day
    // lookup needed). Anchored to a fixed local "now" via fake timers.
    const sameLocalDay = (base: Date) =>
      `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;

    beforeEach(() => {
      // 13:00 local on a fixed day so 13:45 is comfortably "up next".
      const fixed = new Date(2030, 5, 15, 13, 0, 0, 0);
      vi.useFakeTimers();
      vi.setSystemTime(fixed);
      const day = sameLocalDay(fixed);
      const pickedSet = {
        id: 's-next',
        artist: 'Future Headliner',
        stageId: 'st1',
        startTime: '13:45',
        endTime: '14:45',
        dayIndex: 0,
        date: day,
      };
      storeState.currentProfile = { id: 'p1', picks: { 's-next': 'must' } };
      storeState.days = [{ id: 'd1', date: day, dayIndex: 0 }];
      storeState.sets = [pickedSet];
      setFilters({
        allDaySets: [pickedSet],
        timedSets: [pickedSet],
        timelessSets: [],
        visibleStages: [{ id: 'st1', name: 'Main Stage' }],
        timeBounds: { minMin: 780, maxMin: 900, totalSlots: 8 },
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      storeState.currentProfile = undefined;
      storeState.days = undefined;
      storeState.sets = undefined;
    });

    it('renders an "Up next" countdown to the soonest future pick from the device clock', () => {
      render(<TimelineView />);
      const countdown = screen.getByTestId('next-pick-countdown');
      expect(countdown).toHaveTextContent('Up next in');
      expect(countdown).toHaveTextContent('45m');
      expect(countdown).toHaveTextContent('Future Headliner');
    });

    it('does not render the countdown when the user has no upcoming picks', () => {
      storeState.currentProfile = { id: 'p1', picks: {} };
      render(<TimelineView />);
      expect(screen.queryByTestId('next-pick-countdown')).not.toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Shared mutable state object used by all store selectors
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

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/grid/GridStageHeader', () => ({
  default: () => <div data-testid="grid-stage-header" />,
}));

vi.mock('../components/grid/GridStageColumn', () => ({
  default: () => <div data-testid="grid-stage-column" />,
}));

vi.mock('../components/grid/useGridExport', () => ({
  useGridExport: vi.fn(() => ({ exporting: false, exportGrid: vi.fn() })),
}));

vi.mock('../components/grid/gridUtils', () => ({
  getPxPerMin: vi.fn(() => 2),
  getGutterW: vi.fn(() => 52),
  toMin: vi.fn((t: string) => {
    const [h = 0, m = 0] = t.split(':').map(Number);
    return h * 60 + m;
  }),
  fmtHour: vi.fn((totalMin: number) => {
    const h = Math.floor(totalMin / 60) % 24;
    return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
  }),
}));

vi.mock('lucide-react', () => ({
  CalendarX: () => <span data-testid="calendar-x-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
}));

import GridView from './grid';

function setStoreState(overrides: Record<string, unknown> = {}) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    currentFestival: { id: 'f1', name: 'Bonnaroo', b2bSeparator: undefined },
    sets: [],
    stages: [{ id: 'st1', name: 'Main Stage' }],
    selectedDay: 0,
    activeStages: [],
    setDetailSet: vi.fn(),
    ...overrides,
  });
}

describe('GridView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it('renders without crashing', () => {
    const { container } = render(<GridView />);
    expect(container).toBeTruthy();
  });

  it('shows "No festival selected" when no festival', () => {
    setStoreState({ currentFestival: null });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
    expect(screen.getByText('Choose a festival from the top menu to view the schedule grid.')).toBeInTheDocument();
  });

  it('shows "No timed sets to display" when no sets exist', () => {
    setStoreState({ sets: [] });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No timed sets to display')).toBeInTheDocument();
    expect(screen.getByText(/no sets with scheduled times/i)).toBeInTheDocument();
  });

  it('shows "No timed sets" when all sets are for a different day', () => {
    setStoreState({
      sets: [
        { id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 1 },
      ],
      selectedDay: 0,
    });
    render(<GridView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No timed sets to display')).toBeInTheDocument();
  });

  it('renders grid with header and columns when timed sets exist', () => {
    setStoreState({
      sets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
      ],
    });
    render(<GridView />);
    expect(screen.getByTestId('grid-stage-header')).toBeInTheDocument();
    expect(screen.getByTestId('grid-stage-column')).toBeInTheDocument();
  });

  it('renders the grid with correct aria-label', () => {
    setStoreState({
      sets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
      ],
    });
    render(<GridView />);
    expect(screen.getByRole('grid', { name: /Festival schedule grid/i })).toBeInTheDocument();
  });

  it('renders hour labels in the time gutter', () => {
    setStoreState({
      sets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '16:00', dayIndex: 0 },
      ],
    });
    render(<GridView />);
    // With bounds 14:00-16:00 (840-960), hours at 840, 900, 960 => 2pm, 3pm, 4pm
    expect(screen.getByText('2pm')).toBeInTheDocument();
    expect(screen.getByText('3pm')).toBeInTheDocument();
    expect(screen.getByText('4pm')).toBeInTheDocument();
  });

  it('renders a column per visible stage', () => {
    setStoreState({
      stages: [
        { id: 'st1', name: 'Main Stage' },
        { id: 'st2', name: 'Side Stage' },
      ],
      sets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
        { id: 's2', artist: 'Odesza', stageId: 'st2', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
      ],
    });
    render(<GridView />);
    const columns = screen.getAllByTestId('grid-stage-column');
    expect(columns).toHaveLength(2);
  });

  it('filters sets by activeStages when some stages are active', () => {
    setStoreState({
      stages: [
        { id: 'st1', name: 'Main Stage' },
        { id: 'st2', name: 'Side Stage' },
      ],
      activeStages: ['st1'],
      sets: [
        { id: 's1', artist: 'Daft Punk', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
        { id: 's2', artist: 'Odesza', stageId: 'st2', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
      ],
    });
    render(<GridView />);
    // Only one stage is active, so only one column should render
    const columns = screen.getAllByTestId('grid-stage-column');
    expect(columns).toHaveLength(1);
  });

  it('renders the scrollable body rowgroup', () => {
    setStoreState({
      sets: [
        { id: 's1', artist: 'Test', stageId: 'st1', startTime: '14:00', endTime: '15:00', dayIndex: 0 },
      ],
    });
    render(<GridView />);
    expect(screen.getByRole('rowgroup')).toBeInTheDocument();
  });
});

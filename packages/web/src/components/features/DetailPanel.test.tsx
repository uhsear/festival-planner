import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalSet, Priority } from '@festie/shared/types';

// Mock vaul Drawer
vi.mock('vaul', () => ({
  Drawer: {
    Root: ({
      children,
      open,
      onOpenChange: _onOpenChange,
    }: {
      children: React.ReactNode;
      open: boolean;
      onOpenChange: (o: boolean) => void;
    }) => (open ? <div data-testid="drawer-root">{children}</div> : null),
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Overlay: () => <div data-testid="drawer-overlay" />,
    Content: ({ children, ...props }: { children: React.ReactNode; 'aria-label'?: string }) => (
      <div data-testid="drawer-content" aria-label={props['aria-label']}>
        {children}
      </div>
    ),
    Title: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <h2 className={className}>{children}</h2>
    ),
    Description: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <p className={className}>{children}</p>
    ),
  },
}));

// Mock useDetailPanelData
const mockSavePick = vi.fn(async () => {});
const mockSaveNote = vi.fn(async () => {});
const mockSaveReminder = vi.fn(async () => {});
vi.mock('./useDetailPanelData', () => ({
  useDetailPanelData: vi.fn(() => ({
    currentFestival: { id: 'fest-1', name: 'Test Fest' },
    festivalDays: [],
    currentProfile: { id: 'prof-1', picks: {}, notes: {} },
    b2bSeparator: 'b2b',
    stageColor: '#ff3366',
    stageName: 'Main Stage',
    myPick: null as Priority | null,
    myReminder: undefined as number | undefined,
    artistName: 'Daft Punk',
    sub: '',
    artistLinks: [],
    isB2B: false,
    primaryArtist: null,
    allGenres: [],
    conflicts: [],
    others: [],
    crewNotes: [],
    whoTitle: "Who's going",
    savePick: mockSavePick,
    saveReminder: mockSaveReminder,
    saveNote: mockSaveNote,
    getOtherPicks: vi.fn(() => []),
    getStageName: vi.fn(() => 'Main Stage'),
  })),
}));

vi.mock('@festie/shared/services/api', () => ({
  api: { get: vi.fn(async () => null), post: vi.fn(async () => {}) },
}));

vi.mock('@festie/shared/stores/festivalStore', () => ({
  useFestivalStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector({ loadProfiles: vi.fn() }),
    { getState: vi.fn(() => ({ loadProfiles: vi.fn() })) },
  ),
}));

vi.mock('../../hooks/useHaptics', () => ({
  useHaptics: vi.fn(() => ({
    select: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  })),
}));

vi.mock('@festie/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/utils')>()),
  hasSetStarted: vi.fn(() => false),
}));

// Mock sub-components to isolate DetailPanel behavior
vi.mock('./RatingButtons', () => ({ default: () => <div data-testid="rating-buttons" /> }));
vi.mock('./DetailArtistHeader', () => ({
  default: ({ artistName }: { artistName: string }) => <div data-testid="artist-header">{artistName}</div>,
}));
vi.mock('./DetailSpotifySection', () => ({
  default: () => <div data-testid="spotify-section" />,
}));
vi.mock('./DetailConflictWarning', () => ({
  default: () => <div data-testid="conflict-warning" />,
}));
vi.mock('./DetailPriorityPicker', () => ({
  default: ({ onPriorityClick }: { onPriorityClick: (p: Priority | null) => void }) => (
    <div data-testid="priority-picker">
      <button onClick={() => onPriorityClick('must')}>Pick Must</button>
      <button onClick={() => onPriorityClick(null)}>Clear Pick</button>
    </div>
  ),
}));
vi.mock('./DetailCrewSection', () => ({
  default: ({ title }: { title: string }) => <div data-testid="crew-section">{title}</div>,
}));
vi.mock('./DetailNotesSection', () => ({
  default: () => <div data-testid="notes-section" />,
}));

import DetailPanel from './DetailPanel';
import { useDetailPanelData } from './useDetailPanelData';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 'set-1',
    festivalId: 'fest-1',
    stageId: 'stage-1',
    startTime: '14:00',
    endTime: '15:00',
    artist: 'Daft Punk',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function defaultDetailData() {
  return {
    currentFestival: { id: 'fest-1', name: 'Test Fest' } as ReturnType<typeof useDetailPanelData>['currentFestival'],
    festivalDays: [],
    currentProfile: { id: 'prof-1', picks: {}, notes: {} } as ReturnType<typeof useDetailPanelData>['currentProfile'],
    b2bSeparator: 'b2b',
    stageColor: '#ff3366',
    stageName: 'Main Stage',
    myPick: null as Priority | null,
    myReminder: undefined as number | undefined,
    artistName: 'Daft Punk',
    sub: '',
    artistLinks: [] as ReturnType<typeof useDetailPanelData>['artistLinks'],
    isB2B: false,
    primaryArtist: null as ReturnType<typeof useDetailPanelData>['primaryArtist'],
    allGenres: [] as string[],
    conflicts: [] as ReturnType<typeof useDetailPanelData>['conflicts'],
    others: [] as ReturnType<typeof useDetailPanelData>['others'],
    crewNotes: [] as ReturnType<typeof useDetailPanelData>['crewNotes'],
    whoTitle: "Who's going",
    savePick: mockSavePick,
    saveReminder: mockSaveReminder,
    saveNote: mockSaveNote,
    getOtherPicks: vi.fn(() => []) as ReturnType<typeof useDetailPanelData>['getOtherPicks'],
    getStageName: vi.fn(() => 'Main Stage') as ReturnType<typeof useDetailPanelData>['getStageName'],
  };
}

describe('DetailPanel', () => {
  const defaultProps = {
    set: makeSet(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDetailPanelData).mockReturnValue(defaultDetailData());
  });

  it('renders the drawer with set detail aria-label', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByLabelText('Set detail panel')).toBeInTheDocument();
  });

  it('renders the stage name badge', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByText('Main Stage')).toBeInTheDocument();
  });

  it('renders the artist header with artist name', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByTestId('artist-header')).toHaveTextContent('Daft Punk');
  });

  it('renders formatted time range', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByText('2:00 PM - 3:00 PM')).toBeInTheDocument();
  });

  it('renders TBA when times are missing', () => {
    render(<DetailPanel {...defaultProps} set={makeSet({ startTime: '', endTime: '' })} />);
    expect(screen.getByText('TBA')).toBeInTheDocument();
  });

  it('renders the close button', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByLabelText('Close detail panel')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DetailPanel {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByLabelText('Close detail panel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders the priority picker when user has a profile', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByTestId('priority-picker')).toBeInTheDocument();
  });

  it('renders Join Festival CTA when user has no profile', () => {
    vi.mocked(useDetailPanelData).mockReturnValue({
      ...defaultDetailData(),
      currentProfile: null,
    });
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByRole('button', { name: /Join Festival/ })).toBeInTheDocument();
    expect(screen.queryByTestId('priority-picker')).not.toBeInTheDocument();
  });

  it('renders the conflict warning section', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByTestId('conflict-warning')).toBeInTheDocument();
  });

  it('renders the crew section', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByTestId('crew-section')).toBeInTheDocument();
  });

  it('renders notes section when user has a profile', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByTestId('notes-section')).toBeInTheDocument();
  });

  it('calls savePick when a priority is selected', async () => {
    const user = userEvent.setup();
    render(<DetailPanel {...defaultProps} />);
    await user.click(screen.getByText('Pick Must'));
    expect(mockSavePick).toHaveBeenCalledWith('fest-1', 'set-1', 'must');
  });

  it('renders accessible title and description for screen readers', () => {
    render(<DetailPanel {...defaultProps} />);
    // Drawer.Title with sr-only renders the artist name
    expect(screen.getByText('Daft Punk', { selector: 'h2' })).toBeInTheDocument();
  });

  it('renders the reminder picker when user has a profile', () => {
    render(<DetailPanel {...defaultProps} />);
    expect(screen.getByText('Remind me before it starts')).toBeInTheDocument();
  });

  it('calls saveReminder when a reminder option is selected', async () => {
    const user = userEvent.setup();
    render(<DetailPanel {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: 'Remind me 15m before' }));
    expect(mockSaveReminder).toHaveBeenCalledWith('fest-1', 'set-1', 15);
  });

  it('clears the reminder (null) when the active option is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useDetailPanelData).mockReturnValue({
      ...defaultDetailData(),
      myReminder: 30,
    });
    render(<DetailPanel {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: 'Reminder 30m before, click to clear' }));
    expect(mockSaveReminder).toHaveBeenCalledWith('fest-1', 'set-1', null);
  });

  it('surfaces no error and resets busy when saveReminder rejects', async () => {
    const user = userEvent.setup();
    mockSaveReminder.mockRejectedValueOnce(new Error('network'));
    render(<DetailPanel {...defaultProps} />);
    const btn = screen.getByRole('button', { name: 'Remind me 5m before' });
    await user.click(btn);
    expect(mockSaveReminder).toHaveBeenCalledWith('fest-1', 'set-1', 5);
    // handleReminderClick swallows the error and clears reminderBusy in finally,
    // so the buttons become interactive again (not stuck disabled).
    expect(screen.getByRole('button', { name: 'Remind me 5m before' })).not.toBeDisabled();
  });
});

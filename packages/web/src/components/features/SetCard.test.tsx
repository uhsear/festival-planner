import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalSet } from '@festie/shared/types';

// Mock dependencies
vi.mock('@festie/shared/hooks', () => ({
  usePicks: vi.fn(() => ({
    getMyPick: vi.fn(() => null),
    savePick: vi.fn(),
    getMyNote: vi.fn(() => ''),
  })),
}));

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ currentFestival: { id: 'fest-1' } }),
}));

vi.mock('@festie/shared/services/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('@/hooks/useSetStatus', () => ({
  useSetStatus: vi.fn(() => ({ status: 'later', label: '3:00 PM', minutesUntil: 300, progress: 0 })),
}));

vi.mock('@/lib/toastContext', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: vi.fn(() => ({ tap: vi.fn(), select: vi.fn(), warning: vi.fn() })),
}));

vi.mock('./LiveBadge', () => ({
  default: ({ status: _status, label }: { status: string; label: string }) => (
    <div data-testid="live-badge">{label}</div>
  ),
}));

import SetCard from './SetCard';
import { useSetStatus } from '@/hooks/useSetStatus';
import { usePicks } from '@festie/shared/hooks';

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

describe('SetCard', () => {
  const defaultProps = {
    set: makeSet(),
    onTap: vi.fn(),
    stageName: 'Main Stage',
    stageColor: '#ff3366',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSetStatus).mockReturnValue({
      status: 'later',
      label: '2:00 PM',
      minutesUntil: 300,
      progress: 0,
    });
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn(() => null),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => ''),
    });
  });

  it('renders the artist name', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('renders the stage name', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByText('Main Stage')).toBeInTheDocument();
  });

  it('renders the time range', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByText('2:00 PM - 3:00 PM')).toBeInTheDocument();
  });

  it('renders TBA when times are missing', () => {
    render(
      <SetCard
        {...defaultProps}
        set={makeSet({ startTime: undefined as unknown as string, endTime: undefined as unknown as string })}
      />,
    );
    expect(screen.getByText('TBA')).toBeInTheDocument();
  });

  it('has data-testid="set-card"', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByTestId('set-card')).toBeInTheDocument();
  });

  it('has data-artist attribute with artist name', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.getByTestId('set-card')).toHaveAttribute('data-artist', 'Daft Punk');
  });

  it('calls onTap when the card click target is clicked', async () => {
    const onTap = vi.fn();
    const user = userEvent.setup();
    render(<SetCard {...defaultProps} onTap={onTap} />);
    const clickTarget = screen.getByLabelText(/Daft Punk/);
    await user.click(clickTarget);
    expect(onTap).toHaveBeenCalledOnce();
  });

  it('renders the accessible click target with artist and stage info', () => {
    render(<SetCard {...defaultProps} />);
    const btn = screen.getByLabelText(/Daft Punk.*Main Stage.*2:00 PM/);
    expect(btn).toBeInTheDocument();
  });

  describe('priority buttons', () => {
    it('renders 3 priority buttons when showPicks is true', () => {
      render(<SetCard {...defaultProps} showPicks />);
      expect(screen.getByLabelText('Must See')).toBeInTheDocument();
      expect(screen.getByLabelText('Want to See')).toBeInTheDocument();
      expect(screen.getByLabelText('Maybe')).toBeInTheDocument();
    });

    it('does not render priority buttons when showPicks is false', () => {
      render(<SetCard {...defaultProps} showPicks={false} />);
      expect(screen.queryByLabelText('Must See')).not.toBeInTheDocument();
    });

    it('marks the active priority with aria-pressed=true', () => {
      vi.mocked(usePicks).mockReturnValue({
        getMyPick: vi.fn(() => 'must'),
        savePick: vi.fn(),
        getMyNote: vi.fn(() => ''),
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.getByLabelText('Must See (selected)')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByLabelText('Want to See')).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('priority class', () => {
    it('adds priority-must class when pick is must', () => {
      vi.mocked(usePicks).mockReturnValue({
        getMyPick: vi.fn(() => 'must'),
        savePick: vi.fn(),
        getMyNote: vi.fn(() => ''),
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('set-card').className).toContain('priority-must');
    });

    it('adds no priority class when no pick', () => {
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('set-card').className).not.toContain('priority-');
    });
  });

  describe('conflict badge', () => {
    it('shows conflict badge when conflicts exist', () => {
      render(<SetCard {...defaultProps} conflicts={[makeSet({ id: 'set-2' })]} />);
      expect(screen.getByTestId('set-card').className).toContain('has-conflict');
    });

    it('does not show conflict badge when no conflicts', () => {
      render(<SetCard {...defaultProps} conflicts={[]} />);
      expect(screen.getByTestId('set-card').className).not.toContain('has-conflict');
    });
  });

  describe('crew overlap', () => {
    it('shows crew count when friendProfiles are provided', () => {
      render(
        <SetCard
          {...defaultProps}
          friendProfiles={[
            { profileId: 'p1', name: 'Alice', priority: 'must' },
            { profileId: 'p2', name: 'Bob', priority: 'maybe' },
          ]}
        />,
      );
      expect(screen.getByText('2 going')).toBeInTheDocument();
    });

    it('shows singular "1 going" for a single friend', () => {
      render(
        <SetCard
          {...defaultProps}
          friendProfiles={[{ profileId: 'p1', name: 'Alice', priority: 'must' }]}
        />,
      );
      expect(screen.getByText('1 going')).toBeInTheDocument();
    });

    it('hides crew overlap when no friendProfiles', () => {
      render(<SetCard {...defaultProps} friendProfiles={[]} />);
      expect(screen.queryByText(/going/)).not.toBeInTheDocument();
    });
  });

  describe('live badge', () => {
    it('shows LiveBadge when status is live', () => {
      vi.mocked(useSetStatus).mockReturnValue({
        status: 'live',
        label: 'LIVE',
        minutesUntil: -10,
        progress: 0.5,
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });

    it('shows LiveBadge when status is soon', () => {
      vi.mocked(useSetStatus).mockReturnValue({
        status: 'soon',
        label: 'In 15m',
        minutesUntil: 15,
        progress: 0,
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    });

    it('does not show LiveBadge when status is later', () => {
      vi.mocked(useSetStatus).mockReturnValue({
        status: 'later',
        label: '6:00 PM',
        minutesUntil: 300,
        progress: 0,
      });
      render(<SetCard {...defaultProps} />);
      expect(screen.queryByTestId('live-badge')).not.toBeInTheDocument();
    });
  });

  it('renders note indicator when user has a note', () => {
    vi.mocked(usePicks).mockReturnValue({
      getMyPick: vi.fn(() => null),
      savePick: vi.fn(),
      getMyNote: vi.fn(() => 'My note'),
    });
    render(<SetCard {...defaultProps} />);
    expect(screen.getByLabelText('Has note')).toBeInTheDocument();
  });

  it('does not render note indicator when no note', () => {
    render(<SetCard {...defaultProps} />);
    expect(screen.queryByLabelText('Has note')).not.toBeInTheDocument();
  });

  it('applies stage color as background on the stage label', () => {
    render(<SetCard {...defaultProps} stageColor="#00ff00" />);
    const stageEl = screen.getByText('Main Stage');
    expect(stageEl.style.background).toBe('rgb(0, 255, 0)');
  });
});

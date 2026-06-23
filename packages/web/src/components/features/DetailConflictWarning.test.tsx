import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DetailConflictWarning from './DetailConflictWarning';
import type { FestivalSet } from '@festie/shared/types';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 'set-1',
    festivalId: 'fest-1',
    stageId: 'stage-1',
    artist: 'Test Artist',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DetailConflictWarning', () => {
  const defaultProps = {
    currentSetId: 'current-set',
    myPick: 'must' as const,
    getStageName: (id: string) => (id === 'stage-1' ? 'Main Stage' : 'Sahara'),
    getOtherPicks: () => [],
    onSwitch: vi.fn(),
  };

  it('renders nothing when there are no conflicts', () => {
    const { container } = render(
      <DetailConflictWarning {...defaultProps} conflicts={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders conflict warning text with artist names', () => {
    const conflicts = [makeSet({ id: 'c1', artist: 'DJ Snake' })];
    render(
      <DetailConflictWarning {...defaultProps} conflicts={conflicts} />,
    );
    // The warning text includes the unicode ⚠ character followed by " Time conflict with: DJ Snake"
    expect(screen.getByText(/Time conflict with.*DJ Snake/)).toBeInTheDocument();
  });

  it('renders multiple conflicting artists', () => {
    const conflicts = [
      makeSet({ id: 'c1', artist: 'Artist A' }),
      makeSet({ id: 'c2', artist: 'Artist B', stageId: 'stage-2' }),
    ];
    render(
      <DetailConflictWarning {...defaultProps} conflicts={conflicts} />,
    );
    expect(screen.getByText(/Artist A, Artist B/)).toBeInTheDocument();
  });

  it('renders stage name and time for each conflict', () => {
    const conflicts = [
      makeSet({ id: 'c1', artist: 'DJ Snake', startTime: '14:00', endTime: '15:00', stageId: 'stage-1' }),
    ];
    render(
      <DetailConflictWarning {...defaultProps} conflicts={conflicts} />,
    );
    expect(screen.getByText(/Main Stage/)).toBeInTheDocument();
  });

  it('shows crew count when others have picked the conflicting set', () => {
    const conflicts = [makeSet({ id: 'c1', artist: 'DJ Snake' })];
    const getOtherPicks = (setId: string) =>
      setId === 'c1'
        ? [{ profileId: 'p1', priority: 'must' as const }, { profileId: 'p2', priority: 'want-to-see' as const }]
        : [];
    render(
      <DetailConflictWarning
        {...defaultProps}
        conflicts={conflicts}
        getOtherPicks={getOtherPicks}
      />,
    );
    expect(screen.getByText('2 crew going')).toBeInTheDocument();
  });

  it('shows "No crew" when nobody else has picked the conflicting set', () => {
    const conflicts = [makeSet({ id: 'c1', artist: 'DJ Snake' })];
    render(
      <DetailConflictWarning {...defaultProps} conflicts={conflicts} />,
    );
    expect(screen.getByText('No crew')).toBeInTheDocument();
  });

  it('renders switch button with correct aria-label', () => {
    const conflicts = [makeSet({ id: 'c1', artist: 'DJ Snake' })];
    render(
      <DetailConflictWarning {...defaultProps} conflicts={conflicts} />,
    );
    expect(screen.getByLabelText('Switch to DJ Snake')).toBeInTheDocument();
  });

  it('calls onSwitch when switch button is clicked', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake' });
    render(
      <DetailConflictWarning
        {...defaultProps}
        conflicts={[conflict]}
        onSwitch={onSwitch}
      />,
    );
    await user.click(screen.getByText('Switch to this'));
    expect(onSwitch).toHaveBeenCalledWith('current-set', conflict, 'must');
  });

  it('uses want-to-see as default priority when myPick is null', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake' });
    render(
      <DetailConflictWarning
        {...defaultProps}
        myPick={null}
        conflicts={[conflict]}
        onSwitch={onSwitch}
      />,
    );
    await user.click(screen.getByText('Switch to this'));
    expect(onSwitch).toHaveBeenCalledWith('current-set', conflict, 'want-to-see');
  });
});

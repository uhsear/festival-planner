import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClashPrompt from './ClashPrompt';
import type { FestivalSet } from '@festie/shared/types';

function makeSet(overrides: Partial<FestivalSet> = {}): FestivalSet {
  return {
    id: 'set-1',
    festivalId: 'fest-1',
    stageId: 'stage-1',
    artist: 'Test Artist',
    startTime: '20:00',
    endTime: '21:00',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ClashPrompt', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  const current = makeSet({ id: 'current', artist: 'Headliner', startTime: '20:00', endTime: '21:00' });

  it('renders nothing when there are no conflicts', () => {
    const { container } = render(<ClashPrompt currentSet={current} conflicts={[]} onClear={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('names both acts and the overlap start time', () => {
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake', startTime: '20:30', endTime: '21:30' });
    render(<ClashPrompt currentSet={current} conflicts={[conflict]} onClear={vi.fn()} />);
    // Anchors on the later start (20:30 -> 8:30 PM).
    expect(screen.getByText(/2 acts at 8:30 PM — keep one/)).toBeInTheDocument();
    expect(screen.getByText(/Headliner and DJ Snake overlap/)).toBeInTheDocument();
  });

  it('clears the OTHER set when keeping the current set', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake', startTime: '20:30', endTime: '21:30' });
    render(<ClashPrompt currentSet={current} conflicts={[conflict]} onClear={onClear} />);
    await user.click(screen.getByLabelText('Keep Headliner, clear DJ Snake'));
    expect(onClear).toHaveBeenCalledWith('c1');
  });

  it('clears the CURRENT set when keeping the other set', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake', startTime: '20:30', endTime: '21:30' });
    render(<ClashPrompt currentSet={current} conflicts={[conflict]} onClear={onClear} />);
    await user.click(screen.getByLabelText('Keep DJ Snake, clear Headliner'));
    expect(onClear).toHaveBeenCalledWith('current');
  });

  it('dismisses the pair after a choice so it does not re-nag (one-shot)', async () => {
    const user = userEvent.setup();
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake', startTime: '20:30', endTime: '21:30' });
    const { container } = render(<ClashPrompt currentSet={current} conflicts={[conflict]} onClear={vi.fn()} />);
    await user.click(screen.getByLabelText('Keep both acts'));
    expect(container.firstChild).toBeNull();
  });

  it('does not re-show a pair already dismissed this session on remount', () => {
    const conflict = makeSet({ id: 'c1', artist: 'DJ Snake', startTime: '20:30', endTime: '21:30' });
    // Seed the session-dismissed marker for the pair key (prefix + sorted ids).
    sessionStorage.setItem(`festie-clash:${['c1', 'current'].sort().join(':')}`, '1');
    const { container } = render(<ClashPrompt currentSet={current} conflicts={[conflict]} onClear={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one prompt per conflicting pair', () => {
    const conflicts = [
      makeSet({ id: 'c1', artist: 'Artist A', startTime: '20:15', endTime: '21:00' }),
      makeSet({ id: 'c2', artist: 'Artist B', startTime: '20:45', endTime: '21:30' }),
    ];
    render(<ClashPrompt currentSet={current} conflicts={conflicts} onClear={vi.fn()} />);
    expect(screen.getByLabelText('Keep Headliner, clear Artist A')).toBeInTheDocument();
    expect(screen.getByLabelText('Keep Headliner, clear Artist B')).toBeInTheDocument();
  });
});

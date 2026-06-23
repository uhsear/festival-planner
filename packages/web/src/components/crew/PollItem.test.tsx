import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PollItem, { type PollItemProps } from './PollItem';

function makePoll(overrides: Partial<PollItemProps['poll']> = {}): PollItemProps['poll'] {
  return {
    id: 'poll-1',
    created_by: 'user-a',
    question: 'Where should we camp?',
    options: ['North field', 'South field', 'West lot'],
    votes: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<PollItemProps> = {}): PollItemProps {
  return {
    poll: makePoll(),
    index: 0,
    currentUserId: 'user-b',
    isOwner: false,
    isVotePending: false,
    isClosePending: false,
    onVote: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe('PollItem', () => {
  it('renders the poll question', () => {
    render(<PollItem {...makeProps()} />);
    expect(screen.getByText('Where should we camp?')).toBeInTheDocument();
  });

  it('renders all option buttons', () => {
    render(<PollItem {...makeProps()} />);
    expect(screen.getByText('North field')).toBeInTheDocument();
    expect(screen.getByText('South field')).toBeInTheDocument();
    expect(screen.getByText('West lot')).toBeInTheDocument();
  });

  it('shows "0 votes" when no votes exist', () => {
    render(<PollItem {...makeProps()} />);
    expect(screen.getByText('0 votes')).toBeInTheDocument();
  });

  it('shows singular "1 vote" label', () => {
    const poll = makePoll({
      votes: [{ option: 0, user_id: 'user-x' }],
    });
    render(<PollItem {...makeProps({ poll })} />);
    expect(screen.getByText('1 vote')).toBeInTheDocument();
  });

  it('shows plural "N votes" label for multiple votes', () => {
    const poll = makePoll({
      votes: [
        { option: 0, user_id: 'user-x' },
        { option: 1, user_id: 'user-y' },
        { option: 0, user_id: 'user-z' },
      ],
    });
    render(<PollItem {...makeProps({ poll })} />);
    expect(screen.getByText('3 votes')).toBeInTheDocument();
  });

  it('calculates percentages correctly', () => {
    const poll = makePoll({
      options: ['A', 'B'],
      votes: [
        { option: 0, user_id: 'u1' },
        { option: 0, user_id: 'u2' },
        { option: 1, user_id: 'u3' },
      ],
    });
    render(<PollItem {...makeProps({ poll })} />);
    // 2/3 = 67%, 1/3 = 33%
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows 0% for all options when there are no votes', () => {
    const poll = makePoll({ options: ['X', 'Y'] });
    render(<PollItem {...makeProps({ poll })} />);
    const zeroPcts = screen.getAllByText('0%');
    expect(zeroPcts).toHaveLength(2);
  });

  it('marks the current user vote via isMine', () => {
    const poll = makePoll({
      options: ['A', 'B'],
      votes: [{ option: 1, user_id: 'user-b' }],
    });
    render(<PollItem {...makeProps({ poll, currentUserId: 'user-b' })} />);
    const buttons = screen.getAllByRole('button');
    // Option B (index 1) should be pressed
    const optionB = buttons.find((b) => b.getAttribute('aria-pressed') === 'true');
    expect(optionB).toBeDefined();
  });

  it('calls onVote when an option is clicked', async () => {
    const user = userEvent.setup();
    const onVote = vi.fn();
    render(<PollItem {...makeProps({ onVote })} />);
    const buttons = screen.getAllByRole('button');
    // Click the first poll option button (not the close button)
    await user.click(buttons[0]);
    expect(onVote).toHaveBeenCalledWith('poll-1', 0);
  });

  it('shows close button for the poll creator', () => {
    render(<PollItem {...makeProps({ poll: makePoll({ created_by: 'user-b' }), currentUserId: 'user-b' })} />);
    expect(screen.getByText('Close poll')).toBeInTheDocument();
  });

  it('shows close button for crew owner even if not poll creator', () => {
    render(<PollItem {...makeProps({ isOwner: true })} />);
    expect(screen.getByText('Close poll')).toBeInTheDocument();
  });

  it('hides close button for non-owner, non-creator users', () => {
    render(<PollItem {...makeProps({ isOwner: false, currentUserId: 'user-b' })} />);
    expect(screen.queryByText('Close poll')).not.toBeInTheDocument();
  });

  it('calls onClose with poll id when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PollItem {...makeProps({ isOwner: true, onClose })} />);
    await user.click(screen.getByText('Close poll'));
    expect(onClose).toHaveBeenCalledWith('poll-1');
  });

  it('disables close button when isClosePending is true', () => {
    render(<PollItem {...makeProps({ isOwner: true, isClosePending: true })} />);
    const closeBtn = screen.getByText('Close poll').closest('button');
    expect(closeBtn).toBeDisabled();
  });

  it('ignores votes with out-of-range option indices', () => {
    const poll = makePoll({
      options: ['A', 'B'],
      votes: [
        { option: 0, user_id: 'u1' },
        { option: 5, user_id: 'u2' },  // out of range
        { option: -1, user_id: 'u3' }, // negative
      ],
    });
    render(<PollItem {...makeProps({ poll })} />);
    // Only 1 valid vote
    expect(screen.getByText('1 vote')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});

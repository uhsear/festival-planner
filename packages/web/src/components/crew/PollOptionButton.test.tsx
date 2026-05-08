import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PollOptionButton from './PollOptionButton';

describe('PollOptionButton', () => {
  const defaultProps = {
    pollId: 'poll-1',
    optionIndex: 0,
    text: 'Option A',
    pct: 60,
    isMine: false,
    isWinning: false,
    isPending: false,
    onVote: vi.fn(),
  };

  it('renders the option text', () => {
    render(<PollOptionButton {...defaultProps} />);
    expect(screen.getByText('Option A')).toBeInTheDocument();
  });

  it('displays the percentage', () => {
    render(<PollOptionButton {...defaultProps} pct={75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('calls onVote with pollId and optionIndex on click', async () => {
    const user = userEvent.setup();
    const onVote = vi.fn();
    render(<PollOptionButton {...defaultProps} onVote={onVote} />);
    await user.click(screen.getByRole('button'));
    expect(onVote).toHaveBeenCalledWith('poll-1', 0);
  });

  it('is disabled when isPending is true', () => {
    render(<PollOptionButton {...defaultProps} isPending />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('sets aria-pressed=true when isMine', () => {
    render(<PollOptionButton {...defaultProps} isMine />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets aria-pressed=false when not mine', () => {
    render(<PollOptionButton {...defaultProps} isMine={false} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('sets aria-busy=true when isPending', () => {
    render(<PollOptionButton {...defaultProps} isPending />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('applies aqua border when isMine', () => {
    render(<PollOptionButton {...defaultProps} isMine />);
    expect(screen.getByRole('button').className).toContain('border-accent-aqua');
  });

  it('applies normal border when not selected', () => {
    render(<PollOptionButton {...defaultProps} />);
    expect(screen.getByRole('button').className).toContain('border-border');
  });

  it('renders check icon when isMine', () => {
    const { container } = render(<PollOptionButton {...defaultProps} isMine />);
    // Check icon from lucide-react
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('does not render check icon when not mine', () => {
    const { container } = render(<PollOptionButton {...defaultProps} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeNull();
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(<PollOptionButton {...defaultProps} pct={42} />);
    const bar = container.querySelector('.crew-poll-bar');
    expect(bar).toBeInTheDocument();
    expect(bar!.getAttribute('style')).toContain('width: 42%');
  });
});

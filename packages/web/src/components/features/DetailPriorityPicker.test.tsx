import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DetailPriorityPicker from './DetailPriorityPicker';

describe('DetailPriorityPicker', () => {
  const defaultProps = {
    myPick: null as null,
    priorityBusy: null as null,
    onPriorityClick: vi.fn().mockResolvedValue(undefined),
  };

  it('renders all four priority options', () => {
    render(<DetailPriorityPicker {...defaultProps} />);
    expect(screen.getByLabelText('Must See')).toBeInTheDocument();
    expect(screen.getByLabelText('Want to See')).toBeInTheDocument();
    expect(screen.getByLabelText('Maybe')).toBeInTheDocument();
    // When myPick is null, Clear is active (null === null), so label is "Clear (selected)"
    expect(screen.getByLabelText('Clear (selected)')).toBeInTheDocument();
  });

  it('marks active priority as pressed', () => {
    render(<DetailPriorityPicker {...defaultProps} myPick="must" />);
    expect(screen.getByLabelText('Must See (selected)')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Want to See')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('calls onPriorityClick with priority value on click', async () => {
    const user = userEvent.setup();
    const onPriorityClick = vi.fn().mockResolvedValue(undefined);
    render(
      <DetailPriorityPicker {...defaultProps} onPriorityClick={onPriorityClick} />,
    );
    await user.click(screen.getByLabelText('Must See'));
    expect(onPriorityClick).toHaveBeenCalledWith('must');
  });

  it('calls onPriorityClick with null for Clear', async () => {
    const user = userEvent.setup();
    const onPriorityClick = vi.fn().mockResolvedValue(undefined);
    render(
      <DetailPriorityPicker
        {...defaultProps}
        myPick="must"
        onPriorityClick={onPriorityClick}
      />,
    );
    await user.click(screen.getByLabelText('Clear'));
    expect(onPriorityClick).toHaveBeenCalledWith(null);
  });

  it('disables all buttons when any priority is busy', () => {
    render(
      <DetailPriorityPicker {...defaultProps} priorityBusy="must" />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('sets aria-busy on the busy option', () => {
    render(
      <DetailPriorityPicker {...defaultProps} priorityBusy="must" />,
    );
    expect(screen.getByLabelText('Must See')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('Want to See')).toHaveAttribute('aria-busy', 'false');
  });

  it('shows correct icons for each priority', () => {
    render(<DetailPriorityPicker {...defaultProps} />);
    expect(screen.getByLabelText('Must See')).toHaveTextContent('★');
    expect(screen.getByLabelText('Want to See')).toHaveTextContent('◆');
    expect(screen.getByLabelText('Maybe')).toHaveTextContent('●');
    expect(screen.getByLabelText('Clear (selected)')).toHaveTextContent('✕');
  });

  it('adds active styling when priority is selected', () => {
    render(<DetailPriorityPicker {...defaultProps} myPick="want-to-see" />);
    const btn = screen.getByLabelText('Want to See (selected)');
    expect(btn.className).toContain('border-priority-want');
  });

  it('does not add active styling when priority is not selected', () => {
    render(<DetailPriorityPicker {...defaultProps} myPick="must" />);
    const btn = screen.getByLabelText('Maybe');
    expect(btn.className).not.toContain('border-priority-maybe');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptDialog from './PromptDialog';

describe('PromptDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Enter Name',
    onConfirm: vi.fn(),
  };

  it('renders title when open', () => {
    render(<PromptDialog {...defaultProps} />);
    expect(screen.getByText('Enter Name')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<PromptDialog {...defaultProps} description="Please provide a name" />);
    expect(screen.getByText('Please provide a name')).toBeInTheDocument();
  });

  it('renders with default confirm/cancel labels', () => {
    render(<PromptDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('renders with custom confirm/cancel labels', () => {
    render(
      <PromptDialog
        {...defaultProps}
        confirmLabel="Save"
        cancelLabel="Dismiss"
      />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('renders placeholder', () => {
    render(<PromptDialog {...defaultProps} placeholder="Type here..." />);
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
  });

  it('renders default value', () => {
    render(<PromptDialog {...defaultProps} defaultValue="Hello" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Hello');
  });

  it('calls onConfirm with trimmed value on submit', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByRole('textbox');
    await user.type(input, '  test value  ');
    await user.click(screen.getByRole('button', { name: 'OK' }));

    expect(onConfirm).toHaveBeenCalledWith('test value');
  });

  it('does not call onConfirm when value is empty', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not call onConfirm when value is only whitespace', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<PromptDialog {...defaultProps} onConfirm={onConfirm} />);

    const input = screen.getByRole('textbox');
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables confirm button when value is empty', () => {
    render(<PromptDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('displays error message', () => {
    render(<PromptDialog {...defaultProps} error="Name already exists" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Name already exists');
  });

  it('sets aria-invalid on input when error is present', () => {
    render(
      <PromptDialog {...defaultProps} defaultValue="test" error="Invalid" />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables input and confirm when busy', () => {
    render(
      <PromptDialog {...defaultProps} busy defaultValue="test" />,
    );
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });

  it('respects maxLength', () => {
    render(<PromptDialog {...defaultProps} maxLength={10} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('maxLength', '10');
  });

  it('renders Close button', () => {
    render(<PromptDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<PromptDialog {...defaultProps} open={false} />);
    expect(screen.queryByText('Enter Name')).not.toBeInTheDocument();
  });

  it('resets value when dialog opens', async () => {
    const { rerender } = render(
      <PromptDialog {...defaultProps} open={false} defaultValue="initial" />,
    );
    rerender(
      <PromptDialog {...defaultProps} open={true} defaultValue="initial" />,
    );
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveValue('initial');
    });
  });
});

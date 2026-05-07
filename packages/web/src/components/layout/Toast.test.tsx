import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toast from './Toast';

// Test Toast in isolation by mocking useToast
vi.mock('../../lib/toastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/toastContext')>();
  return {
    ...actual,
    useToast: vi.fn(),
  };
});

import { useToast } from '../../lib/toastContext';
const mockUseToast = vi.mocked(useToast);

function setupMockToast(toasts: Array<{
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  onUndo?: () => void;
}>) {
  mockUseToast.mockReturnValue({
    toasts,
    toast: vi.fn(),
    toastUndo: vi.fn(),
    removeToast: vi.fn(),
    pauseToast: vi.fn(),
    resumeToast: vi.fn(),
  });
}

describe('Toast', () => {
  it('renders nothing when there are no toasts', () => {
    setupMockToast([]);
    const { container } = render(<Toast />);
    const toastContainer = container.querySelector('[aria-live="polite"]');
    expect(toastContainer).toBeInTheDocument();
    expect(toastContainer?.children.length).toBe(0);
  });

  it('renders a success toast with status role', () => {
    setupMockToast([{ id: '1', message: 'Saved!', type: 'success' }]);
    render(<Toast />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an error toast with alert role', () => {
    setupMockToast([{ id: '1', message: 'Failed', type: 'error' }]);
    render(<Toast />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders a warning toast with alert role', () => {
    setupMockToast([{ id: '1', message: 'Watch out', type: 'warning' }]);
    render(<Toast />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders an info toast with status role', () => {
    setupMockToast([{ id: '1', message: 'FYI', type: 'info' }]);
    render(<Toast />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    setupMockToast([
      { id: '1', message: 'First', type: 'success' },
      { id: '2', message: 'Second', type: 'error' },
    ]);
    render(<Toast />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('calls removeToast when close button is clicked', async () => {
    const removeMock = vi.fn();
    mockUseToast.mockReturnValue({
      toasts: [{ id: 'toast-1', message: 'Bye', type: 'info' }],
      toast: vi.fn(),
      toastUndo: vi.fn(),
      removeToast: removeMock,
      pauseToast: vi.fn(),
      resumeToast: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Toast />);
    await user.click(screen.getByLabelText('Close'));
    expect(removeMock).toHaveBeenCalledWith('toast-1');
  });

  it('shows Undo button when onUndo is provided', () => {
    setupMockToast([{ id: '1', message: 'Deleted', type: 'info', onUndo: vi.fn() }]);
    render(<Toast />);
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('does not show Undo button when onUndo is not provided', () => {
    setupMockToast([{ id: '1', message: 'Info', type: 'info' }]);
    render(<Toast />);
    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
  });

  it('calls onUndo when Undo button is clicked', async () => {
    const undoFn = vi.fn();
    setupMockToast([{ id: '1', message: 'Removed', type: 'info', onUndo: undoFn }]);
    const user = userEvent.setup();
    render(<Toast />);
    await user.click(screen.getByText('Undo'));
    expect(undoFn).toHaveBeenCalledOnce();
  });

  it('has aria-live=polite container for toast announcements', () => {
    setupMockToast([]);
    const { container } = render(<Toast />);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('aria-atomic', 'false');
  });
});

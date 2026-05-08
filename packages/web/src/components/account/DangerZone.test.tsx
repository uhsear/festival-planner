import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DangerZone from './DangerZone';

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

const mockLogout = vi.fn().mockResolvedValue(undefined);
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ logout: mockLogout }),
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockApiDelete = vi.fn();
vi.mock('@festie/shared/services/api', () => ({
  api: { delete: (...args: unknown[]) => mockApiDelete(...args) },
  getApiBase: () => 'http://localhost:3000/api',
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: export fetch succeeds
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(['{}'])),
  } as Response);

  // Stub URL methods used by export
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('DangerZone', () => {
  // --- Export section ---

  it('renders the Export Data section', () => {
    render(<DangerZone />);
    expect(screen.getByText('Export Data')).toBeInTheDocument();
    expect(screen.getByText('Download My Data')).toBeInTheDocument();
  });

  it('triggers data export download on click', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const anchor = { href: '', download: '', click: clickSpy } as unknown as HTMLElement;
        return anchor;
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    });

    render(<DangerZone />);
    await user.click(screen.getByText('Download My Data'));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(mockToast).toHaveBeenCalledWith('Export downloaded', 'success');
  });

  it('shows error toast when export fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
    } as Response);

    render(<DangerZone />);
    await user.click(screen.getByText('Download My Data'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't export data. Try again.",
        'error',
      );
    });
  });

  // --- Delete account section ---

  it('renders the Delete Account section', () => {
    render(<DangerZone />);
    expect(screen.getByText('Delete Account')).toBeInTheDocument();
    expect(screen.getByText('Delete My Account')).toBeInTheDocument();
  });

  it('does not show password field initially', () => {
    render(<DangerZone />);
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });

  it('shows confirmation form after clicking Delete My Account', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByText('Confirm Delete')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('disables Confirm Delete when password is empty', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    expect(screen.getByText('Confirm Delete').closest('button')).toBeDisabled();
  });

  it('enables Confirm Delete after typing a password', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypass123');

    expect(screen.getByText('Confirm Delete').closest('button')).not.toBeDisabled();
  });

  it('hides confirmation and clears password on Cancel', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'secret');
    await user.click(screen.getByText('Cancel'));

    // Back to initial state
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
    expect(screen.getByText('Delete My Account')).toBeInTheDocument();
  });

  it('calls API delete, logout, and navigates on successful deletion', async () => {
    const user = userEvent.setup();
    mockApiDelete.mockResolvedValue(undefined);

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypassword');
    await user.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/account/', {
        body: { password: 'mypassword' },
      });
    });
    expect(mockLogout).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith('Account deleted', 'info');
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
  });

  it('shows error toast when account deletion fails', async () => {
    const user = userEvent.setup();
    mockApiDelete.mockRejectedValue(new Error('fail'));

    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));
    await user.type(screen.getByPlaceholderText('Password'), 'mypassword');
    await user.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't delete account. Try again.",
        'error',
      );
    });
  });

  it('does not call handleDelete if password field is empty on submit', async () => {
    const user = userEvent.setup();
    render(<DangerZone />);
    await user.click(screen.getByText('Delete My Account'));

    // Submit form without typing a password (button is disabled, but test the guard)
    const form = screen.getByPlaceholderText('Password').closest('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true }));

    expect(mockApiDelete).not.toHaveBeenCalled();
  });
});

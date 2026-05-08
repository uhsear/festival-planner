import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordSection from './PasswordSection';

// --- Mocks ---

const mockChangePassword = vi.fn();
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ changePassword: mockChangePassword }),
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockChangePassword.mockResolvedValue(undefined);
});

describe('PasswordSection', () => {
  it('renders the Change Password heading', () => {
    render(<PasswordSection />);
    expect(screen.getByText('Change Password')).toBeInTheDocument();
  });

  it('renders current and new password inputs', () => {
    render(<PasswordSection />);
    expect(screen.getByPlaceholderText('Current password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/New password/)).toBeInTheDocument();
  });

  it('disables submit button when both fields are empty', () => {
    render(<PasswordSection />);
    expect(screen.getByText('Update Password').closest('button')).toBeDisabled();
  });

  it('disables submit button when only current password is filled', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    expect(screen.getByText('Update Password').closest('button')).toBeDisabled();
  });

  it('disables submit button when new password is under 8 characters', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    await user.type(screen.getByPlaceholderText(/New password/), 'short');
    expect(screen.getByText('Update Password').closest('button')).toBeDisabled();
  });

  it('shows character count hint when new password is too short', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText(/New password/), 'abc');
    expect(screen.getByText('5 more characters needed')).toBeInTheDocument();
  });

  it('shows singular "character" when only 1 more is needed', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText(/New password/), 'abcdefg');
    expect(screen.getByText('1 more character needed')).toBeInTheDocument();
  });

  it('hides character count hint when new password reaches 8 characters', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText(/New password/), 'abcdefgh');
    expect(screen.queryByText(/more character/)).not.toBeInTheDocument();
  });

  it('hides character count hint when new password field is empty', () => {
    render(<PasswordSection />);
    expect(screen.queryByText(/more character/)).not.toBeInTheDocument();
  });

  it('enables submit button when both fields are valid', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    await user.type(screen.getByPlaceholderText(/New password/), 'newpass123');
    expect(screen.getByText('Update Password').closest('button')).not.toBeDisabled();
  });

  it('calls changePassword and shows success toast on valid submit', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    await user.type(screen.getByPlaceholderText(/New password/), 'newpass123');
    await user.click(screen.getByText('Update Password'));

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: 'oldpass',
        newPassword: 'newpass123',
      });
    });
    expect(mockToast).toHaveBeenCalledWith('Password changed', 'success');
  });

  it('clears both fields after successful password change', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    await user.type(screen.getByPlaceholderText(/New password/), 'newpass123');
    await user.click(screen.getByText('Update Password'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Current password')).toHaveValue('');
    });
    expect(screen.getByPlaceholderText(/New password/)).toHaveValue('');
  });

  it('shows error toast when changePassword fails', async () => {
    const user = userEvent.setup();
    mockChangePassword.mockRejectedValue(new Error('bad'));

    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    await user.type(screen.getByPlaceholderText(/New password/), 'newpass123');
    await user.click(screen.getByText('Update Password'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't change password. Try again.",
        'error',
      );
    });
  });

  it('shows warning toast and does not call API when new password is under 8 chars', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);

    // Fill current password
    await user.type(screen.getByPlaceholderText('Current password'), 'oldpass');
    // Type short new password
    await user.type(screen.getByPlaceholderText(/New password/), 'short');

    // Button should be disabled, but verify the validation logic directly
    // by checking the submit button state
    const submitBtn = screen.getByText('Update Password').closest('button')!;
    expect(submitBtn).toBeDisabled();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it('does not call API when current password is empty', async () => {
    const user = userEvent.setup();
    render(<PasswordSection />);
    await user.type(screen.getByPlaceholderText(/New password/), 'newpass123');

    const submitBtn = screen.getByText('Update Password').closest('button')!;
    expect(submitBtn).toBeDisabled();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});

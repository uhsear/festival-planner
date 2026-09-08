import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChangeEmailModal from './ChangeEmailModal';

const onSubmit = vi.fn();
const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onSubmit.mockResolvedValue(undefined);
});

const renderModal = (currentEmail = 'old@example.com') =>
  render(<ChangeEmailModal currentEmail={currentEmail} onClose={onClose} onSubmit={onSubmit} />);

const fillForm = async (user: ReturnType<typeof userEvent.setup>, email = 'new@example.com') => {
  await user.type(screen.getByLabelText('New email'), email);
  await user.type(screen.getByLabelText('Current password'), 'hunter2hunter2');
};

describe('ChangeEmailModal', () => {
  it('renders as a labelled dialog with both fields', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Change email' })).toBeInTheDocument();
    expect(screen.getByText('Change Email')).toBeInTheDocument();
    expect(screen.getByLabelText('New email')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('explains that the address only changes once the link is used', () => {
    renderModal();
    expect(screen.getByText(/login email\s+stays the same until you open that link/)).toBeInTheDocument();
  });

  it('says "Add Email" when no address is on file', () => {
    render(<ChangeEmailModal onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByRole('dialog', { name: 'Change email' })).toBeInTheDocument();
    expect(screen.getByText('Add Email')).toBeInTheDocument();
  });

  it('disables submit until both fields are filled', async () => {
    const user = userEvent.setup();
    renderModal();
    const submit = screen.getByRole('button', { name: 'Send Verification Link' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('New email'), 'new@example.com');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Current password'), 'hunter2hunter2');
    expect(submit).toBeEnabled();
  });

  it('submits the trimmed address with the current password', async () => {
    const user = userEvent.setup();
    renderModal();
    await fillForm(user, '  new@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Send Verification Link' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('new@example.com', 'hunter2hunter2'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the server message inline when the password is wrong', async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValue(
      Object.assign(new Error('Incorrect password'), { name: 'ApiClientError', status: 400, retryAfter: null }),
    );
    renderModal();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Send Verification Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password');
  });

  it('shows a wait-and-retry message when the route rate limits', async () => {
    const user = userEvent.setup();
    onSubmit.mockRejectedValue(
      Object.assign(new Error('Too many requests'), { name: 'ApiClientError', status: 429, retryAfter: '30' }),
    );
    renderModal();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Send Verification Link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests — try again in 30s.');
    // Still open and retryable — the modal never closes itself on failure.
    expect(screen.getByRole('button', { name: 'Send Verification Link' })).toBeEnabled();
  });

  it('closes on Cancel', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

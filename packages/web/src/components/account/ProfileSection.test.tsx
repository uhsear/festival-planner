import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---------------------------------------------------------------

// Stub the lucide icons used by ProfileSection AND by the shared Button it
// renders (Button shows a <Loader> while isLoading). Each becomes a span with
// a name-derived data-testid.
vi.mock('lucide-react', () => {
  const stubIcon = (name: string) => () => <span data-testid={`${name}-icon`} />;
  return {
    AtSign: stubIcon('AtSign'),
    Camera: stubIcon('Camera'),
    Trash2: stubIcon('Trash2'),
    User: stubIcon('User'),
    Loader: stubIcon('Loader'),
  };
});

// authStore is consumed via selectors: useAuthStore((s) => s.x). We hold a
// mutable state object and run the selector against it, mirroring the real
// zustand surface (user / setUser / uploadAvatar / removeAvatar).
const mockSetUser = vi.fn();
const mockUploadAvatar = vi.fn().mockResolvedValue(undefined);
const mockRemoveAvatar = vi.fn().mockResolvedValue(undefined);

let authState: Record<string, unknown>;

function resetAuth(overrides: Record<string, unknown> = {}) {
  authState = {
    user: { id: 'u1', name: 'Ada Lovelace', username: 'ada' },
    setUser: mockSetUser,
    uploadAvatar: mockUploadAvatar,
    removeAvatar: mockRemoveAvatar,
    ...overrides,
  };
}

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(authState),
}));

const mockApiPut = vi.fn();
vi.mock('@festie/shared/services/api', () => ({
  api: {
    put: (...args: unknown[]) => mockApiPut(...args),
  },
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import ProfileSection from './ProfileSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadAvatar.mockResolvedValue(undefined);
  mockRemoveAvatar.mockResolvedValue(undefined);
  mockApiPut.mockResolvedValue({ user: { name: 'Ada Lovelace' } });
  resetAuth();
});

describe('ProfileSection — rendering', () => {
  it('renders the display-name input pre-filled with the current name', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('Ada Lovelace');
  });

  it('shows the read-only @username and the immutable hint', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    expect(screen.getByText('@ada')).toBeInTheDocument();
    expect(screen.getByText(/username can’t be changed/)).toBeInTheDocument();
    // There is no input for the username — it is display-only text.
    expect(screen.queryByDisplayValue('ada')).not.toBeInTheDocument();
  });

  it('omits the @username block when no username is present', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace' }} />);
    expect(screen.queryByText(/username can’t be changed/)).not.toBeInTheDocument();
  });

  it('renders the Display name and Avatar section headings', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    expect(screen.getByText('Display name')).toBeInTheDocument();
    expect(screen.getByText('Avatar')).toBeInTheDocument();
  });
});

describe('ProfileSection — display name submission', () => {
  it('PUTs /account/display-name with the trimmed new name', async () => {
    const user = userEvent.setup();
    mockApiPut.mockResolvedValue({ user: { name: 'Grace Hopper' } });
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, '  Grace Hopper  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mockApiPut).toHaveBeenCalledWith('/account/display-name', { displayName: 'Grace Hopper' });
  });

  it('merges the returned name into the auth store via setUser', async () => {
    const user = userEvent.setup();
    mockApiPut.mockResolvedValue({ user: { name: 'Grace Hopper' } });
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace Hopper');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockSetUser).toHaveBeenCalledWith({
        id: 'u1',
        name: 'Grace Hopper',
        username: 'ada',
      }),
    );
  });

  it('falls back to the typed name when the response omits a name', async () => {
    const user = userEvent.setup();
    mockApiPut.mockResolvedValue({ user: {} });
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Katherine');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({ name: 'Katherine' })));
  });

  it('shows a success toast after saving', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Display name updated', 'success'));
  });

  it('shows an error toast and does not call setUser when the request fails', async () => {
    const user = userEvent.setup();
    mockApiPut.mockRejectedValue(new Error('network'));
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);

    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Couldn't change display name. Try again.", 'error'));
    expect(mockSetUser).not.toHaveBeenCalled();
  });
});

describe('ProfileSection — Save button enablement', () => {
  it('disables Save when the name is unchanged', () => {
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save when the input is empty', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('disables Save when the input is only whitespace', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save once the name changes to a non-empty value', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada Lovelace', username: 'ada' }} />);
    const input = screen.getByPlaceholderText('How your name appears to your crew');
    await user.clear(input);
    await user.type(input, 'Grace Hopper');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('ProfileSection — avatar controls', () => {
  it('shows the Remove button only when the user has an avatar', () => {
    const { rerender } = render(<ProfileSection user={{ name: 'Ada', username: 'ada' }} />);
    // Upload is always present; Remove (trash icon) only with an avatar.
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.queryByTestId('Trash2-icon')).not.toBeInTheDocument();

    rerender(<ProfileSection user={{ name: 'Ada', username: 'ada', avatar: 'https://x/y.png' }} />);
    expect(screen.getByTestId('Trash2-icon')).toBeInTheDocument();
  });

  it('calls removeAvatar when the Remove button is clicked', async () => {
    const user = userEvent.setup();
    render(<ProfileSection user={{ name: 'Ada', username: 'ada', avatar: 'https://x/y.png' }} />);
    await user.click(screen.getByTestId('Trash2-icon').closest('button')!);
    await waitFor(() => expect(mockRemoveAvatar).toHaveBeenCalledTimes(1));
  });
});

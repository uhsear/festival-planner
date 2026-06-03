import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the router — account.tsx redirects to /login via useNavigate when no user.
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// account.tsx imports the auth store from the deep path, not the barrel.
const storeState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(storeState)),
}));

// Stub the section sub-components and Avatar so the page is isolated; we only
// assert that each section renders, not its internals (covered by their own tests).
vi.mock('../components/account/ProfileSection', () => ({
  default: () => <div data-testid="profile-section" />,
}));
vi.mock('../components/account/PasswordSection', () => ({
  default: () => <div data-testid="password-section" />,
}));
vi.mock('../components/account/NotificationSection', () => ({
  default: () => <div data-testid="notification-section" />,
}));
vi.mock('../components/account/NotificationPrefsSection', () => ({
  default: () => <div data-testid="notification-prefs-section" />,
}));
vi.mock('../components/account/DangerZone', () => ({
  default: () => <div data-testid="danger-zone" />,
}));
vi.mock('../components/account/PaymentHandlesSection', () => ({
  default: () => <div data-testid="payment-handles-section" />,
}));
vi.mock('../components/ui/Avatar', () => ({
  default: ({ name }: { name: string }) => <div data-testid="avatar" data-name={name} />,
}));

// Pass-through error boundary so a render throw isn't swallowed in tests.
vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AccountPage from './account';

function setStoreState(overrides: Record<string, unknown> = {}) {
  Object.keys(storeState).forEach((k) => delete storeState[k]);
  Object.assign(storeState, {
    user: {
      id: 'u1',
      name: 'Test User',
      username: 'testuser',
      email: 'test@festie.us',
    },
    ...overrides,
  });
}

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState();
  });

  it('renders the identity header with display name, @username, and email when logged in', () => {
    render(<AccountPage />);
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('@testuser')).toBeInTheDocument();
    expect(screen.getByText('test@festie.us')).toBeInTheDocument();
    // Avatar receives the display name.
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-name', 'Test User');
  });

  it('redirects to /login when there is no user', () => {
    setStoreState({ user: null });
    const { container } = render(<AccountPage />);
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/login' });
    // Inner component returns null while the redirect is in-flight.
    expect(container.firstChild).toBeNull();
  });

  it('renders all section sub-components when logged in', () => {
    render(<AccountPage />);
    expect(screen.getByTestId('profile-section')).toBeInTheDocument();
    expect(screen.getByTestId('password-section')).toBeInTheDocument();
    expect(screen.getByTestId('notification-section')).toBeInTheDocument();
    expect(screen.getByTestId('notification-prefs-section')).toBeInTheDocument();
    expect(screen.getByTestId('danger-zone')).toBeInTheDocument();
  });

  it('falls back to the username as the display name when no name is set', () => {
    setStoreState({
      user: { id: 'u1', username: 'testuser', email: 'test@festie.us' },
    });
    render(<AccountPage />);
    // Display name (and avatar) fall back to the username.
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-name', 'testuser');
    expect(screen.getByText('@testuser')).toBeInTheDocument();
  });
});

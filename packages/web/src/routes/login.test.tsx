import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}));

vi.mock('@festie/shared', () => ({
  useAuth: vi.fn(() => ({
    login: vi.fn(),
    isLoading: false,
    error: null,
  })),
}));

vi.mock('../lib/toastContext', () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LoginPage from './login';
import { useAuth } from '@festie/shared';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
  });

  it('renders the FESTIE logo', () => {
    render(<LoginPage />);
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<LoginPage />);
    expect(screen.getByText('Plan your sets. Sync with your crew.')).toBeInTheDocument();
  });

  it('renders Login and Create Account tabs', () => {
    render(<LoginPage />);
    expect(screen.getByRole('tab', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('renders username and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  it('renders the login button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
  });

  it('renders Forgot password link', () => {
    render(<LoginPage />);
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
  });

  it('shows "Username is required" when submitting with empty fields', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Username is required');
  });

  it('shows "Password is required" when username is filled but password is empty', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'testuser');
    await user.click(screen.getByRole('button', { name: 'Login' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password is required');
  });

  it('shows loading state when isLoading is true', () => {
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: true,
      error: null,
    });
    render(<LoginPage />);
    expect(screen.getByText('Logging in...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logging in...' })).toBeDisabled();
  });

  it('calls login with username and password on valid submit', async () => {
    const mockLogin = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      login: mockLogin,
      register: vi.fn(),
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Login' }));
    expect(mockLogin).toHaveBeenCalledWith({ username: 'alice', password: 'secret123' });
  });
});

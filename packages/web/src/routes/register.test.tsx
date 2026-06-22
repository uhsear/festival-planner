import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies
const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@festie/shared', () => ({
  useAuth: vi.fn(() => ({
    register: vi.fn(),
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

import RegisterPage from './register';
import { useAuth } from '@festie/shared';

describe('RegisterPage', () => {
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
    render(<RegisterPage />);
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });

  it('renders the tagline', () => {
    render(<RegisterPage />);
    expect(screen.getByText('Plan your sets. Sync with your crew.')).toBeInTheDocument();
  });

  it('renders Login and Create Account tabs', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('tab', { name: 'Create Account' })).toBeInTheDocument();
    // Sign in is a Link, rendered as an <a>
    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('renders all form fields', () => {
    render(<RegisterPage />);
    expect(screen.getByPlaceholderText('Username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Email/)).toBeInTheDocument();
  });

  it('renders TOS checkbox and links', () => {
    render(<RegisterPage />);
    expect(screen.getByText(/I agree to the/)).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
  });

  it('renders the Create Account button', () => {
    render(<RegisterPage />);
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('shows "Username is required" on empty submit', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Username is required');
  });

  it('shows "Password is required" when only username is filled', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password is required');
  });

  it('shows "Password must be at least 8 characters" for short password', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'short');
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Password must be at least 8 characters');
  });

  it('shows "Passwords do not match" when passwords differ', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'password123');
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'different99');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
  });

  it('shows "You must accept the Terms of Service" when TOS unchecked', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'password123');
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(screen.getByRole('alert')).toHaveTextContent('You must accept the Terms of Service');
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
    render(<RegisterPage />);
    expect(screen.getByText('Creating account…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled();
  });

  it('calls register on valid submit', async () => {
    const mockRegister = vi.fn().mockResolvedValue(undefined);
    vi.mocked(useAuth).mockReturnValue({
      login: vi.fn(),
      register: mockRegister,
      logout: vi.fn(),
      forgotPassword: vi.fn(),
      changePassword: vi.fn(),
      uploadAvatar: vi.fn(),
      removeAvatar: vi.fn(),
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByPlaceholderText('Username'), 'alice');
    await user.type(screen.getByPlaceholderText('Password'), 'password123');
    await user.type(screen.getByPlaceholderText('Confirm Password'), 'password123');
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1995-01-01' } });
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create Account' }));
    expect(mockRegister).toHaveBeenCalledWith({
      username: 'alice',
      password: 'password123',
      confirmPassword: 'password123',
      dateOfBirth: '1995-01-01',
      tosAccepted: true,
      email: undefined,
    });
  });
});

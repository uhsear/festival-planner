import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuth } from '../useAuth';
import { useAuthStore } from '../../stores/authStore';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('../../stores/resetStores', () => ({
  resetAllStores: vi.fn(),
}));

function resetStore() {
  useAuthStore.setState({
    user: null,
    userToken: null,
    isAdmin: false,
    adminToken: null,
    isLoading: false,
    error: null,
    sessionChecked: false,
  });
}

describe('useAuth hook', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('returns login function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.login).toBe('function');
  });

  it('returns register function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.register).toBe('function');
  });

  it('returns logout function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.logout).toBe('function');
  });

  it('returns forgotPassword function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.forgotPassword).toBe('function');
  });

  it('returns changePassword function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.changePassword).toBe('function');
  });

  it('returns uploadAvatar function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.uploadAvatar).toBe('function');
  });

  it('returns removeAvatar function from the auth store', () => {
    const { result } = renderHook(() => useAuth());
    expect(typeof result.current.removeAvatar).toBe('function');
  });

  it('reflects isLoading from the auth store', () => {
    useAuthStore.setState({ isLoading: true });
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(true);
  });

  it('reflects error from the auth store', () => {
    useAuthStore.setState({ error: 'Something went wrong' });
    const { result } = renderHook(() => useAuth());
    expect(result.current.error).toBe('Something went wrong');
  });

  it('returns null error when store has no error', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.error).toBeNull();
  });

  it('returns false isLoading by default', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isLoading).toBe(false);
  });

  it('returns all expected keys in the return value', () => {
    const { result } = renderHook(() => useAuth());
    const keys = Object.keys(result.current);
    expect(keys).toContain('login');
    expect(keys).toContain('register');
    expect(keys).toContain('logout');
    expect(keys).toContain('forgotPassword');
    expect(keys).toContain('changePassword');
    expect(keys).toContain('uploadAvatar');
    expect(keys).toContain('removeAvatar');
    expect(keys).toContain('isLoading');
    expect(keys).toContain('error');
  });
});

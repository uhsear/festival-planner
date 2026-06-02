import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from './authStore';
import { api, setAuthToken, clearAuthToken, getAuthToken } from '../services/api';
import type { User } from '../types/domain';

vi.mock('../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  setAuthToken: vi.fn(),
  clearAuthToken: vi.fn(),
  getAuthToken: vi.fn(),
  getApiBase: vi.fn(() => '/api/v1'),
}));

vi.mock('./resetStores', () => ({
  resetAllStores: vi.fn(),
}));

const mockUser: User = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@test.com',
  name: 'Alice',
  isAdmin: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

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

describe('authStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with null user', () => {
      expect(useAuthStore.getState().user).toBeNull();
    });

    it('starts with null userToken', () => {
      expect(useAuthStore.getState().userToken).toBeNull();
    });

    it('starts with isAdmin false', () => {
      expect(useAuthStore.getState().isAdmin).toBe(false);
    });

    it('starts not loading', () => {
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('starts with null error', () => {
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('starts with sessionChecked false', () => {
      expect(useAuthStore.getState().sessionChecked).toBe(false);
    });
  });

  describe('login', () => {
    it('sets user and token on successful login', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        user: mockUser,
        token: 'tok-123',
        roles: [],
      });
      await useAuthStore.getState().login({ username: 'alice', password: 'pass' });
      const state = useAuthStore.getState();
      expect(state.user).toEqual({ ...mockUser, isAdmin: false });
      expect(state.userToken).toBe('tok-123');
      expect(state.isLoading).toBe(false);
      expect(setAuthToken).toHaveBeenCalledWith('tok-123');
    });

    it('sets isAdmin true when roles include admin', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        user: mockUser,
        token: 'tok-123',
        roles: ['admin'],
      });
      await useAuthStore.getState().login({ username: 'alice', password: 'pass' });
      expect(useAuthStore.getState().isAdmin).toBe(true);
    });

    it('sets isAdmin true when user.isAdmin is true', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        user: { ...mockUser, isAdmin: true },
        token: 'tok-123',
      });
      await useAuthStore.getState().login({ username: 'alice', password: 'pass' });
      expect(useAuthStore.getState().isAdmin).toBe(true);
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Bad credentials'));
      await expect(useAuthStore.getState().login({ username: 'alice', password: 'wrong' })).rejects.toThrow(
        'Bad credentials',
      );
      expect(useAuthStore.getState().error).toBe('Bad credentials');
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useAuthStore.getState().login({ username: 'a', password: 'b' })).rejects.toBe('string error');
      expect(useAuthStore.getState().error).toBe('Login failed');
    });

    it('handles login response without token', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        user: mockUser,
        roles: [],
      });
      await useAuthStore.getState().login({ username: 'alice', password: 'pass' });
      const state = useAuthStore.getState();
      expect(state.user).toEqual({ ...mockUser, isAdmin: false });
      expect(state.userToken).toBeNull();
      expect(setAuthToken).not.toHaveBeenCalled();
    });
  });

  describe('register', () => {
    it('sets user on successful register', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        user: mockUser,
        token: 'tok-reg',
      });
      await useAuthStore.getState().register({
        username: 'alice',
        password: 'pass',
        confirmPassword: 'pass',
        tosAccepted: true,
      });
      expect(useAuthStore.getState().user).toEqual(mockUser);
      expect(useAuthStore.getState().userToken).toBe('tok-reg');
      expect(setAuthToken).toHaveBeenCalledWith('tok-reg');
    });

    it('sets error and throws on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Username taken'));
      await expect(
        useAuthStore.getState().register({
          username: 'alice',
          password: 'p',
          confirmPassword: 'p',
          tosAccepted: true,
        }),
      ).rejects.toThrow();
      expect(useAuthStore.getState().error).toBe('Username taken');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(
        useAuthStore.getState().register({
          username: 'alice',
          password: 'p',
          confirmPassword: 'p',
          tosAccepted: true,
        }),
      ).rejects.toBe('string error');
      expect(useAuthStore.getState().error).toBe('Registration failed');
    });

    it('handles register response without token', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        user: mockUser,
      });
      await useAuthStore.getState().register({
        username: 'alice',
        password: 'pass',
        confirmPassword: 'pass',
        tosAccepted: true,
      });
      const state = useAuthStore.getState();
      expect(state.user).toEqual(mockUser);
      expect(state.userToken).toBeNull();
      expect(setAuthToken).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('clears user state and calls resetAllStores', async () => {
      useAuthStore.setState({
        user: mockUser,
        userToken: 'tok-123',
        isAdmin: true,
      });
      vi.mocked(api.post).mockResolvedValueOnce(undefined);
      await useAuthStore.getState().logout();
      const state = useAuthStore.getState();
      expect(state.user).toBeNull();
      expect(state.userToken).toBeNull();
      expect(state.isAdmin).toBe(false);
      expect(clearAuthToken).toHaveBeenCalled();
    });

    it('still clears local state even if server call fails', async () => {
      useAuthStore.setState({ user: mockUser, userToken: 'tok-123' });
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Server down'));
      await useAuthStore.getState().logout();
      expect(useAuthStore.getState().user).toBeNull();
      expect(clearAuthToken).toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    it('updates token on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({ token: 'tok-new' });
      await useAuthStore.getState().refreshToken();
      expect(useAuthStore.getState().userToken).toBe('tok-new');
      expect(setAuthToken).toHaveBeenCalledWith('tok-new');
    });

    it('clears auth and throws on failure', async () => {
      useAuthStore.setState({ user: mockUser, userToken: 'tok-old' });
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Expired'));
      await expect(useAuthStore.getState().refreshToken()).rejects.toThrow();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().userToken).toBeNull();
      expect(clearAuthToken).toHaveBeenCalled();
    });
  });

  describe('setUser', () => {
    it('sets user and derives isAdmin', () => {
      useAuthStore.getState().setUser({ ...mockUser, isAdmin: true });
      expect(useAuthStore.getState().user!.isAdmin).toBe(true);
      expect(useAuthStore.getState().isAdmin).toBe(true);
    });

    it('clears user with null', () => {
      useAuthStore.getState().setUser(mockUser);
      useAuthStore.getState().setUser(null);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().isAdmin).toBe(false);
    });
  });

  describe('checkSession', () => {
    it('returns true and sets user on valid session', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        user: mockUser,
        roles: ['admin'],
      });
      const result = await useAuthStore.getState().checkSession();
      expect(result).toBe(true);
      expect(useAuthStore.getState().user).toEqual({ ...mockUser, isAdmin: true });
      expect(useAuthStore.getState().sessionChecked).toBe(true);
    });

    it('returns false and clears user when no user in response', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({ user: null });
      const result = await useAuthStore.getState().checkSession();
      expect(result).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().sessionChecked).toBe(true);
    });

    it('returns false and sets sessionChecked on error', async () => {
      vi.mocked(api.get).mockRejectedValueOnce(new Error('401'));
      const result = await useAuthStore.getState().checkSession();
      expect(result).toBe(false);
      expect(useAuthStore.getState().sessionChecked).toBe(true);
    });
  });

  describe('forgotPassword', () => {
    it('completes without error on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(undefined);
      await useAuthStore.getState().forgotPassword({ email: 'test@test.com' });
      expect(useAuthStore.getState().isLoading).toBe(false);
      expect(useAuthStore.getState().error).toBeNull();
    });

    it('sets error on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Not found'));
      await expect(useAuthStore.getState().forgotPassword({ email: 'bad@test.com' })).rejects.toThrow();
      expect(useAuthStore.getState().error).toBe('Not found');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(useAuthStore.getState().forgotPassword({ email: 'bad@test.com' })).rejects.toBe('string error');
      expect(useAuthStore.getState().error).toBe('Request failed');
    });
  });

  describe('changePassword', () => {
    it('completes without error on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce(undefined);
      await useAuthStore.getState().changePassword({
        currentPassword: 'old',
        newPassword: 'new',
      });
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.mocked(api.post).mockRejectedValueOnce(new Error('Wrong password'));
      await expect(
        useAuthStore.getState().changePassword({
          currentPassword: 'wrong',
          newPassword: 'new',
        }),
      ).rejects.toThrow();
      expect(useAuthStore.getState().error).toBe('Wrong password');
    });

    it('handles non-Error thrown values', async () => {
      vi.mocked(api.post).mockRejectedValueOnce('string error');
      await expect(
        useAuthStore.getState().changePassword({
          currentPassword: 'old',
          newPassword: 'new',
        }),
      ).rejects.toBe('string error');
      expect(useAuthStore.getState().error).toBe('Change password failed');
    });
  });

  describe('uploadAvatar', () => {
    it('uploads avatar and updates user on success', async () => {
      useAuthStore.setState({ user: mockUser });
      const mockBlob = new Blob(['img'], { type: 'image/png' });
      // Raw fetch -> the server envelope { data, error } is NOT auto-unwrapped.
      // The serialized user exposes the new avatar as `avatarUrl`.
      const mockResponse = {
        ok: true,
        json: async () => ({
          data: { user: { ...mockUser, avatarUrl: 'https://cdn.test/avatar.png' } },
          error: null,
        }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const result = await useAuthStore.getState().uploadAvatar(mockBlob);
      expect(result.user.avatarUrl).toBe('https://cdn.test/avatar.png');
      expect(useAuthStore.getState().user!.avatarUrl).toBe('https://cdn.test/avatar.png');
      expect(useAuthStore.getState().isLoading).toBe(false);

      vi.mocked(globalThis.fetch).mockRestore();
    });

    it('rolls back avatar on upload failure', async () => {
      useAuthStore.setState({ user: { ...mockUser, avatarUrl: 'old-avatar.jpg' } });
      const mockBlob = new Blob(['img'], { type: 'image/png' });
      const mockResponse = {
        ok: false,
        json: async () => ({}),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      await expect(useAuthStore.getState().uploadAvatar(mockBlob)).rejects.toThrow('Upload failed');
      expect(useAuthStore.getState().user!.avatarUrl).toBe('old-avatar.jpg');
      expect(useAuthStore.getState().error).toBe('Upload failed');
      expect(useAuthStore.getState().isLoading).toBe(false);

      vi.mocked(globalThis.fetch).mockRestore();
    });

    it('rolls back to undefined avatar when previous avatar was undefined', async () => {
      useAuthStore.setState({ user: { ...mockUser, avatarUrl: undefined } });
      const mockBlob = new Blob(['img'], { type: 'image/png' });
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await expect(useAuthStore.getState().uploadAvatar(mockBlob)).rejects.toThrow('Network error');
      expect(useAuthStore.getState().user!.avatarUrl).toBeUndefined();
      expect(useAuthStore.getState().error).toBe('Network error');

      vi.mocked(globalThis.fetch).mockRestore();
    });

    it('handles non-Error thrown values on failure', async () => {
      useAuthStore.setState({ user: mockUser });
      const mockBlob = new Blob(['img'], { type: 'image/png' });
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce('string error');

      await expect(useAuthStore.getState().uploadAvatar(mockBlob)).rejects.toBe('string error');
      expect(useAuthStore.getState().error).toBe('Avatar upload failed');

      vi.mocked(globalThis.fetch).mockRestore();
    });

    it('includes Authorization header when bearer token exists', async () => {
      useAuthStore.setState({ user: mockUser });
      vi.mocked(getAuthToken).mockReturnValue('test-bearer-token');

      const mockBlob = new Blob(['img'], { type: 'image/png' });
      const mockResponse = {
        ok: true,
        json: async () => ({ data: { user: { ...mockUser, avatarUrl: 'https://cdn.test/avatar.png' } }, error: null }),
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      await useAuthStore.getState().uploadAvatar(mockBlob);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'omit',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-bearer-token',
          }),
        }),
      );

      fetchSpy.mockRestore();
    });

    it('handles upload when user is null', async () => {
      useAuthStore.setState({ user: null });
      const mockBlob = new Blob(['img'], { type: 'image/png' });
      const mockResponse = {
        ok: true,
        json: async () => ({ data: { user: { ...mockUser, avatarUrl: 'https://cdn.test/avatar.png' } }, error: null }),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse as unknown as Response);

      const result = await useAuthStore.getState().uploadAvatar(mockBlob);
      expect(result.user.avatarUrl).toBe('https://cdn.test/avatar.png');
      // user stays null since there's no user to update
      expect(useAuthStore.getState().user).toBeNull();

      vi.mocked(globalThis.fetch).mockRestore();
    });
  });

  describe('removeAvatar', () => {
    it('clears avatar from user on success', async () => {
      useAuthStore.setState({ user: { ...mockUser, avatarUrl: 'old.jpg' } });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useAuthStore.getState().removeAvatar();
      expect(useAuthStore.getState().user!.avatarUrl).toBeUndefined();
    });

    it('sets error on failure', async () => {
      useAuthStore.setState({ user: mockUser });
      vi.mocked(api.delete).mockRejectedValueOnce(new Error('Failed'));
      await expect(useAuthStore.getState().removeAvatar()).rejects.toThrow();
      expect(useAuthStore.getState().error).toBe('Failed');
    });

    it('handles non-Error thrown values', async () => {
      useAuthStore.setState({ user: mockUser });
      vi.mocked(api.delete).mockRejectedValueOnce('string error');
      await expect(useAuthStore.getState().removeAvatar()).rejects.toBe('string error');
      expect(useAuthStore.getState().error).toBe('Remove avatar failed');
    });

    it('handles remove when user is null', async () => {
      useAuthStore.setState({ user: null });
      vi.mocked(api.delete).mockResolvedValueOnce(undefined);
      await useAuthStore.getState().removeAvatar();
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error string', () => {
      useAuthStore.getState().setError('Something went wrong');
      expect(useAuthStore.getState().error).toBe('Something went wrong');
    });

    it('clears error with null', () => {
      useAuthStore.getState().setError('err');
      useAuthStore.getState().setError(null);
      expect(useAuthStore.getState().error).toBeNull();
    });
  });
});

import { create, StateCreator } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import { api, setAuthToken, clearAuthToken, getApiBase, getAuthToken } from '../services/api';
import { TRUSTED_MUTATION_HEADER } from '../constants/config';
import { getStorage } from '../platform/storage';
import { resetAllStores } from './resetStores';
import {
  User,
  LoginRequest,
  RegisterRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  AvatarResponse,
} from '../types';

export interface AuthState {
  user: User | null;
  userToken: string | null;
  isAdmin: boolean;
  adminToken: string | null;
  isLoading: boolean;
  error: string | null;
  // Flips true once checkSession has run (success or failure). Consumers that
  // fire authenticated requests on mount should wait for this to avoid racing
  // hydrated-from-localStorage user state against /auth/me verification.
  sessionChecked: boolean;
}

export interface AuthActions {
  login: (request: LoginRequest) => Promise<void>;
  register: (request: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  setUser: (user: User | null) => void;
  checkSession: () => Promise<boolean>;
  forgotPassword: (request: ForgotPasswordRequest) => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  uploadAvatar: (file: File | Blob) => Promise<AvatarResponse>;
  removeAvatar: () => Promise<void>;
  setError: (error: string | null) => void;
}

export type AuthStore = AuthState & AuthActions;

const defaultStorage: PersistStorage<AuthState> = {
  getItem: (name) => {
    const raw = getStorage().getItem(name);
    // Handle both sync (localStorage) and async (AsyncStorage) adapters
    if (raw instanceof Promise) {
      return raw.then((item) => {
        if (!item) return null;
        try {
          return JSON.parse(item);
        } catch {
          return null;
        }
      });
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    getStorage().setItem(name, JSON.stringify(value));
  },
  removeItem: (name) => {
    getStorage().removeItem(name);
  },
};

const authStore: StateCreator<AuthStore> = (set, get) => ({
  user: null,
  userToken: null,
  isAdmin: false,
  adminToken: null,
  isLoading: false,
  error: null,
  sessionChecked: false,

  login: async (request: LoginRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<{ user: User; token?: string; roles?: string[] }>('/auth/login', request);
      const { user, token, roles } = response;
      if (token) {
        setAuthToken(token);
      }
      const isAdmin = roles?.includes('admin') || user.isAdmin || false;
      set({
        user: { ...user, isAdmin },
        userToken: token || null,
        isAdmin,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  register: async (request: RegisterRequest) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.post<{ user: User; token?: string }>('/auth/register', request);
      const { user, token } = response;
      if (token) {
        setAuthToken(token);
      }
      set({
        user,
        userToken: token || null,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Server call failed — proceed with local cleanup regardless.
    }
    clearAuthToken();
    set({
      user: null,
      userToken: null,
      isAdmin: false,
      adminToken: null,
      isLoading: false,
    });
    resetAllStores();
    // Web only: purge the service-worker API cache so a shared-device account
    // switch can't repaint the previous user's cached responses. No-op on RN /
    // Node where the CacheStorage global is absent.
    if (typeof caches !== 'undefined') {
      caches.delete('api-cache').catch(() => {});
    }
  },

  refreshToken: async () => {
    try {
      const response = await api.post<{ token: string }>('/auth/refresh', {});
      const { token } = response;
      if (token) {
        setAuthToken(token);
        set({ userToken: token });
      }
    } catch (err) {
      clearAuthToken();
      set({ user: null, userToken: null });
      throw err;
    }
  },

  setUser: (user: User | null) => {
    set({ user, isAdmin: user?.isAdmin || false });
  },

  checkSession: async (): Promise<boolean> => {
    try {
      const response = await api.get<{ user: User; roles?: string[] }>('/auth/me');
      if (response && response.user) {
        const isAdmin = response.roles?.includes('admin') || response.user.isAdmin || false;
        set({ user: { ...response.user, isAdmin }, isAdmin, sessionChecked: true });
        return true;
      }
      // Authenticated probe succeeded but returned no user — genuinely logged out.
      clearAuthToken();
      set({ user: null, isAdmin: false, userToken: null, sessionChecked: true });
      return false;
    } catch (err) {
      // A transient network failure (e.g. offline cold start) must NOT log the
      // user out — preserve the persisted session and let a later reconnect /
      // foreground re-verify. Only a genuine auth failure (non-network, e.g.
      // 401) clears the session + the in-memory bearer token. Duck-typed on the
      // ApiClientError shape so it survives module mocks / realm boundaries.
      const e = err as { isNetworkError?: boolean; status?: number } | null;
      if (e && (e.isNetworkError === true || e.status === 0)) {
        set({ sessionChecked: true });
        return false;
      }
      clearAuthToken();
      set({ user: null, isAdmin: false, userToken: null, sessionChecked: true });
      return false;
    }
  },

  forgotPassword: async (request: ForgotPasswordRequest) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/auth/forgot-password', request);
      set({ isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Request failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  changePassword: async (request: ChangePasswordRequest) => {
    set({ isLoading: true, error: null });
    try {
      await api.post('/auth/change-password', request);
      set({ isLoading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Change password failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  updateUsername: async (username: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.put<{ user: User }>('/account/username', { username });
      set((s) => ({
        user: s.user
          ? { ...s.user, username: res.user.username, name: res.user.username }
          : null,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Username update failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  deleteAccount: async (password: string) => {
    set({ isLoading: true, error: null });
    try {
      await api.delete('/account/', { body: { password } });
      // logout() clears the token and resets all stores, matching web's flow.
      await get().logout();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Account deletion failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  uploadAvatar: async (file: File | Blob) => {
    // Capture the previous avatar up front so we can roll back on failure
    // and avoid leaving a stale/broken URL in the store.
    const previousAvatar = get().user?.avatar;
    set({ isLoading: true, error: null });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {
        [TRUSTED_MUTATION_HEADER]: '1',
      };
      const bearer = getAuthToken();
      if (bearer) {
        headers['Authorization'] = `Bearer ${bearer}`;
      }
      const response = await fetch(`${getApiBase()}/account/avatar`, {
        method: 'POST',
        credentials: bearer ? 'omit' : 'same-origin',
        headers,
        body: formData,
      });
      if (!response.ok) {
        throw new Error('Upload failed');
      }
      // Only update user.avatar after we've verified the upload succeeded
      // and parsed the new URL from the response.
      const data = (await response.json()) as AvatarResponse;
      set((state) => ({
        user: state.user ? { ...state.user, avatar: data.url } : null,
        isLoading: false,
      }));
      return data;
    } catch (err) {
      // Roll back any partial avatar change to the previous value.
      set((state) => ({
        user: state.user ? { ...state.user, avatar: previousAvatar } : null,
        error: err instanceof Error ? err.message : 'Avatar upload failed',
        isLoading: false,
      }));
      throw err;
    }
  },

  removeAvatar: async () => {
    set({ isLoading: true, error: null });
    try {
      await api.delete('/account/avatar');
      set((state) => ({
        user: state.user ? { ...state.user, avatar: undefined } : null,
        isLoading: false,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Remove avatar failed';
      set({ error: message, isLoading: false });
      throw err;
    }
  },

  setError: (error: string | null) => {
    set({ error });
  },
});

export const useAuthStore = create<AuthStore>()(
  persist(authStore, {
    name: 'festie-auth',
    storage: defaultStorage,
  }),
);

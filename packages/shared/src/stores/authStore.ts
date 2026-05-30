import { create, StateCreator } from 'zustand';
import { persist, PersistStorage, StorageValue } from 'zustand/middleware';
import { api, setAuthToken, clearAuthToken, getApiBase, getAuthToken } from '../services/api';
import { TRUSTED_MUTATION_HEADER } from '../constants/config';
import { getStorage, getSecureStorage } from '../platform/storage';
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

// Credential fields kept OUT of the regular (AsyncStorage / localStorage) blob
// and stored via the secure adapter (Keychain/Keystore on native) instead.
const SECURE_FIELDS = ['userToken', 'adminToken'] as const;
const SECURE_PREFIX = 'festie-secure-';

/**
 * Split PersistStorage: the non-credential state persists to the regular
 * adapter, while userToken/adminToken persist to the secure adapter
 * (getSecureStorage). getItem transparently merges the secure tokens back into
 * the returned state, so the AuthGate's onFinishHydration sees `userToken`
 * unchanged — no change to the (fragile) cold-start hydration path. Migration
 * is automatic: an old blob that still carries a token is read normally, and
 * the next setItem moves it to secure storage + strips it from the blob.
 * On the web (no OS keychain) getSecureStorage falls back to the regular
 * adapter, so the only change there is the storage key.
 */
const defaultStorage: PersistStorage<AuthState> = {
  getItem: async (name) => {
    const raw = await Promise.resolve(getStorage().getItem(name));
    let parsed: { state?: Record<string, unknown> } | null = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    if (parsed && parsed.state) {
      for (const field of SECURE_FIELDS) {
        const secureVal = await Promise.resolve(getSecureStorage().getItem(SECURE_PREFIX + field));
        // Prefer the secure value; otherwise keep whatever the (old) blob had
        // so a pre-migration install stays logged in until the next write.
        if (secureVal != null) parsed.state[field] = secureVal;
      }
    }
    return (parsed as unknown) as StorageValue<AuthState> | null;
  },
  setItem: async (name, value) => {
    const state = { ...(value.state as unknown as Record<string, unknown>) };
    const tokens: Record<string, unknown> = {};
    for (const field of SECURE_FIELDS) {
      tokens[field] = state[field];
      delete state[field]; // never write credentials to the regular blob
    }
    await Promise.resolve(getStorage().setItem(name, JSON.stringify({ ...value, state })));
    for (const field of SECURE_FIELDS) {
      const v = tokens[field];
      if (typeof v === 'string' && v) {
        await Promise.resolve(getSecureStorage().setItem(SECURE_PREFIX + field, v));
      } else {
        await Promise.resolve(getSecureStorage().removeItem(SECURE_PREFIX + field));
      }
    }
  },
  removeItem: async (name) => {
    await Promise.resolve(getStorage().removeItem(name));
    for (const field of SECURE_FIELDS) {
      await Promise.resolve(getSecureStorage().removeItem(SECURE_PREFIX + field));
    }
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

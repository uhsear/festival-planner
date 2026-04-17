import { create, StateCreator } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';
import { api, setAuthToken, clearAuthToken, getApiBase, getAuthToken } from '../services/api';
import { TRUSTED_MUTATION_HEADER } from '../constants/config';
import {
  User,
  LoginRequest,
  RegisterRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  UploadAvatarRequest,
  AvatarResponse,
} from '../types';

export interface AuthState {
  user: User | null;
  userToken: string | null;
  isAdmin: boolean;
  adminToken: string | null;
  isLoading: boolean;
  error: string | null;
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
  uploadAvatar: (file: File | Blob) => Promise<AvatarResponse>;
  removeAvatar: () => Promise<void>;
  setError: (error: string | null) => void;
}

export type AuthStore = AuthState & AuthActions;

const defaultStorage: PersistStorage<AuthState> = {
  getItem: (name) => {
    const item = typeof window !== 'undefined' ? localStorage.getItem(name) : null;
    if (!item) return null;
    try {
      return JSON.parse(item);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(name, JSON.stringify(value));
    }
  },
  removeItem: (name) => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(name);
    }
  },
};

const authStore: StateCreator<AuthStore> = (set) => ({
  user: null,
  userToken: null,
  isAdmin: false,
  adminToken: null,
  isLoading: false,
  error: null,

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
      clearAuthToken();
      set({
        user: null,
        userToken: null,
        isAdmin: false,
        adminToken: null,
        isLoading: false,
      });
    } catch (err) {
      clearAuthToken();
      set({
        user: null,
        userToken: null,
        isAdmin: false,
        adminToken: null,
        isLoading: false,
      });
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
        set({ user: { ...response.user, isAdmin }, isAdmin });
        return true;
      }
      return false;
    } catch {
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

  uploadAvatar: async (file: File | Blob) => {
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
      const data = (await response.json()) as AvatarResponse;
      set((state) => ({
        user: state.user ? { ...state.user, avatar: data.url } : null,
        isLoading: false,
      }));
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Avatar upload failed';
      set({ error: message, isLoading: false });
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

import { create, StateCreator } from 'zustand';
import { FestivalSet, OnlineUser } from '../types';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  /** auto-dismiss delay in ms; the platform <Toaster> owns the timer */
  durationMs: number;
}

export interface ToastOptions {
  kind?: ToastKind;
  durationMs?: number;
}

let _toastSeq = 0;

export interface UIState {
  // Trade-off: stores a full FestivalSet object for convenience (avoids a
  // lookup-by-id in every consumer). The downside is that stale copies can
  // linger if the canonical set list is updated elsewhere. If this becomes a
  // problem, switch to `detailSetId: string | null` and derive the object via
  // a selector that joins against the festivalStore sets array.
  detailSet: FestivalSet | null;
  detailAutoSpotify: boolean;
  connected: boolean;
  offlineMode: boolean;
  pendingSync: number;
  onlineUsers: OnlineUser[];
  toasts: Toast[];
}

export interface UIActions {
  setDetailSet: (set: FestivalSet | null) => void;
  setDetailAutoSpotify: (v: boolean) => void;
  setConnected: (connected: boolean) => void;
  setOfflineMode: (offline: boolean) => void;
  setPendingSync: (count: number) => void;
  setOnlineUsers: (users: OnlineUser[]) => void;
  addOnlineUser: (user: OnlineUser) => void;
  removeOnlineUser: (userId: string) => void;
  /** Queue a transient toast; returns its id. Replaces blocking Alert.alert for confirmations. */
  showToast: (message: string, options?: ToastOptions) => number;
  dismissToast: (id: number) => void;
}

export type UIStore = UIState & UIActions;

const uiStore: StateCreator<UIStore> = (set) => ({
  detailSet: null,
  detailAutoSpotify: false,
  connected: false,
  offlineMode: false,
  pendingSync: 0,
  onlineUsers: [],
  toasts: [],

  setDetailSet: (detailSet: FestivalSet | null) => {
    set({ detailSet });
  },

  setDetailAutoSpotify: (detailAutoSpotify: boolean) => {
    set({ detailAutoSpotify });
  },

  setConnected: (connected: boolean) => {
    set({ connected });
  },

  setOfflineMode: (offline: boolean) => {
    set({ offlineMode: offline });
  },

  setPendingSync: (count: number) => {
    set({ pendingSync: count });
  },

  setOnlineUsers: (users: OnlineUser[]) => {
    set({ onlineUsers: users });
  },

  addOnlineUser: (user: OnlineUser) => {
    set((state) => ({
      onlineUsers: state.onlineUsers.some((u) => u.id === user.id)
        ? state.onlineUsers.map((u) => (u.id === user.id ? user : u))
        : [...state.onlineUsers, user],
    }));
  },

  removeOnlineUser: (userId: string) => {
    set((state) => ({
      onlineUsers: state.onlineUsers.filter((u) => u.id !== userId),
    }));
  },

  showToast: (message: string, options?: ToastOptions) => {
    const id = ++_toastSeq;
    const toast: Toast = {
      id,
      message,
      kind: options?.kind ?? 'info',
      durationMs: options?.durationMs ?? 2500,
    };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    return id;
  },

  dismissToast: (id: number) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },
});

export const useUIStore = create<UIStore>()(uiStore);

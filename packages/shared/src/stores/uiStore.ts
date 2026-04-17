import { create, StateCreator } from 'zustand';
import { FestivalSet, OnlineUser } from '../types';

export interface UIState {
  detailSet: FestivalSet | null;
  detailSetTrigger: string | null;
  connected: boolean;
  offlineMode: boolean;
  pendingSync: number;
  canInstall: boolean;
  installPromptEvent: Event | null;
  appInstalled: boolean;
  serviceWorkerReady: boolean;
  onlineUsers: OnlineUser[];
}

export interface UIActions {
  setDetailSet: (set: FestivalSet | null) => void;
  setDetailSetTrigger: (trigger: string | null) => void;
  setConnected: (connected: boolean) => void;
  setOfflineMode: (offline: boolean) => void;
  setPendingSync: (count: number) => void;
  setCanInstall: (canInstall: boolean) => void;
  setInstallPromptEvent: (event: Event | null) => void;
  setAppInstalled: (installed: boolean) => void;
  setServiceWorkerReady: (ready: boolean) => void;
  setOnlineUsers: (users: OnlineUser[]) => void;
  addOnlineUser: (user: OnlineUser) => void;
  removeOnlineUser: (userId: string) => void;
}

export type UIStore = UIState & UIActions;

const uiStore: StateCreator<UIStore> = (set) => ({
  detailSet: null,
  detailSetTrigger: null,
  connected: false,
  offlineMode: false,
  pendingSync: 0,
  canInstall: false,
  installPromptEvent: null,
  appInstalled: false,
  serviceWorkerReady: false,
  onlineUsers: [],

  setDetailSet: (detailSet: FestivalSet | null) => {
    set({ detailSet });
  },

  setDetailSetTrigger: (trigger: string | null) => {
    set({ detailSetTrigger: trigger });
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

  setCanInstall: (canInstall: boolean) => {
    set({ canInstall });
  },

  setInstallPromptEvent: (event: Event | null) => {
    set({ installPromptEvent: event });
  },

  setAppInstalled: (installed: boolean) => {
    set({ appInstalled: installed });
  },

  setServiceWorkerReady: (ready: boolean) => {
    set({ serviceWorkerReady: ready });
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
});

export const useUIStore = create<UIStore>()(uiStore);

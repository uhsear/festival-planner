import { create, StateCreator } from 'zustand';
import { FestivalSet, OnlineUser } from '../types';

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
}

export type UIStore = UIState & UIActions;

const uiStore: StateCreator<UIStore> = (set) => ({
  detailSet: null,
  detailAutoSpotify: false,
  connected: false,
  offlineMode: false,
  pendingSync: 0,
  onlineUsers: [],

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
});

export const useUIStore = create<UIStore>()(uiStore);

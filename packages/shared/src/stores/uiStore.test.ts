import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from './uiStore';
import type { OnlineUser } from '../types/domain';

describe('uiStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      detailSet: null,
      detailAutoSpotify: false,
      connected: false,
      offlineMode: false,
      pendingSync: 0,
      onlineUsers: [],
    });
  });

  describe('initial state', () => {
    it('starts with null detailSet', () => {
      expect(useUIStore.getState().detailSet).toBeNull();
    });

    it('starts disconnected', () => {
      expect(useUIStore.getState().connected).toBe(false);
    });

    it('starts online (not offline mode)', () => {
      expect(useUIStore.getState().offlineMode).toBe(false);
    });

    it('starts with 0 pending syncs', () => {
      expect(useUIStore.getState().pendingSync).toBe(0);
    });

    it('starts with empty onlineUsers', () => {
      expect(useUIStore.getState().onlineUsers).toEqual([]);
    });

    it('starts with detailAutoSpotify false', () => {
      expect(useUIStore.getState().detailAutoSpotify).toBe(false);
    });
  });

  describe('setDetailSet', () => {
    it('sets the detail set', () => {
      const mockSet = { id: 'set-1' } as any;
      useUIStore.getState().setDetailSet(mockSet);
      expect(useUIStore.getState().detailSet).toEqual(mockSet);
    });

    it('clears the detail set with null', () => {
      useUIStore.getState().setDetailSet({ id: 'set-1' } as any);
      useUIStore.getState().setDetailSet(null);
      expect(useUIStore.getState().detailSet).toBeNull();
    });
  });

  describe('setDetailAutoSpotify', () => {
    it('sets auto-spotify to true', () => {
      useUIStore.getState().setDetailAutoSpotify(true);
      expect(useUIStore.getState().detailAutoSpotify).toBe(true);
    });

    it('sets auto-spotify to false', () => {
      useUIStore.getState().setDetailAutoSpotify(true);
      useUIStore.getState().setDetailAutoSpotify(false);
      expect(useUIStore.getState().detailAutoSpotify).toBe(false);
    });
  });

  describe('setConnected', () => {
    it('sets connected to true', () => {
      useUIStore.getState().setConnected(true);
      expect(useUIStore.getState().connected).toBe(true);
    });

    it('sets connected to false', () => {
      useUIStore.getState().setConnected(true);
      useUIStore.getState().setConnected(false);
      expect(useUIStore.getState().connected).toBe(false);
    });
  });

  describe('setOfflineMode', () => {
    it('sets offline mode to true', () => {
      useUIStore.getState().setOfflineMode(true);
      expect(useUIStore.getState().offlineMode).toBe(true);
    });

    it('sets offline mode to false', () => {
      useUIStore.getState().setOfflineMode(true);
      useUIStore.getState().setOfflineMode(false);
      expect(useUIStore.getState().offlineMode).toBe(false);
    });
  });

  describe('setPendingSync', () => {
    it('sets the pending sync count', () => {
      useUIStore.getState().setPendingSync(5);
      expect(useUIStore.getState().pendingSync).toBe(5);
    });

    it('sets to zero', () => {
      useUIStore.getState().setPendingSync(3);
      useUIStore.getState().setPendingSync(0);
      expect(useUIStore.getState().pendingSync).toBe(0);
    });
  });

  describe('setOnlineUsers', () => {
    it('replaces the entire online users list', () => {
      const users: OnlineUser[] = [
        { id: 'u1', status: 'online' },
        { id: 'u2', status: 'away' },
      ];
      useUIStore.getState().setOnlineUsers(users);
      expect(useUIStore.getState().onlineUsers).toEqual(users);
    });

    it('clears with empty array', () => {
      useUIStore.getState().setOnlineUsers([{ id: 'u1', status: 'online' }]);
      useUIStore.getState().setOnlineUsers([]);
      expect(useUIStore.getState().onlineUsers).toEqual([]);
    });
  });

  describe('addOnlineUser', () => {
    it('adds a new user to the list', () => {
      const user: OnlineUser = { id: 'u1', name: 'Alice', status: 'online' };
      useUIStore.getState().addOnlineUser(user);
      expect(useUIStore.getState().onlineUsers).toHaveLength(1);
      expect(useUIStore.getState().onlineUsers[0]).toEqual(user);
    });

    it('updates existing user instead of duplicating', () => {
      const user1: OnlineUser = { id: 'u1', name: 'Alice', status: 'online' };
      const user1Updated: OnlineUser = { id: 'u1', name: 'Alice', status: 'away' };
      useUIStore.getState().addOnlineUser(user1);
      useUIStore.getState().addOnlineUser(user1Updated);
      expect(useUIStore.getState().onlineUsers).toHaveLength(1);
      expect(useUIStore.getState().onlineUsers[0]!.status).toBe('away');
    });

    it('appends a different user', () => {
      useUIStore.getState().addOnlineUser({ id: 'u1', status: 'online' });
      useUIStore.getState().addOnlineUser({ id: 'u2', status: 'online' });
      expect(useUIStore.getState().onlineUsers).toHaveLength(2);
    });
  });

  describe('removeOnlineUser', () => {
    it('removes a user by id', () => {
      useUIStore.getState().setOnlineUsers([
        { id: 'u1', status: 'online' },
        { id: 'u2', status: 'online' },
      ]);
      useUIStore.getState().removeOnlineUser('u1');
      expect(useUIStore.getState().onlineUsers).toHaveLength(1);
      expect(useUIStore.getState().onlineUsers[0]!.id).toBe('u2');
    });

    it('does nothing when user not found', () => {
      useUIStore.getState().setOnlineUsers([{ id: 'u1', status: 'online' }]);
      useUIStore.getState().removeOnlineUser('u999');
      expect(useUIStore.getState().onlineUsers).toHaveLength(1);
    });
  });
});

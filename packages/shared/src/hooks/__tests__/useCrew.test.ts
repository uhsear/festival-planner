import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCrew } from '../useCrew';
import { useCrewStore } from '../../stores/crewStore';
import { useFestivalStore } from '../../stores/festivalStore';

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

function resetStores() {
  useCrewStore.setState({
    crews: [],
    activeCrew: null,
    crewMembers: [],
    isLoading: false,
    error: null,
  });
  useFestivalStore.setState({
    currentFestivalId: null,
    currentFestival: null,
    festivals: [],
    stages: [],
    sets: [],
    days: [],
    currentProfile: null,
    allProfiles: [],
    isLoading: false,
    error: null,
  });
}

describe('useCrew hook', () => {
  beforeEach(() => {
    resetStores();
  });

  describe('getCrewScopedProfiles', () => {
    it('returns empty array when no crew members', () => {
      const { result } = renderHook(() => useCrew());
      expect(result.current.getCrewScopedProfiles()).toEqual([]);
    });

    it('returns profiles that match crew member userIds', () => {
      useCrewStore.setState({
        crewMembers: [
          { id: 'm1', userId: 'u1', name: 'Alice' },
          { id: 'm2', userId: 'u2', name: 'Bob' },
        ],
      });
      useFestivalStore.setState({
        allProfiles: [
          {
            id: 'p1', userId: 'u1', festivalId: 'f1', picks: {}, notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2', userId: 'u2', festivalId: 'f1', picks: {}, notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p3', userId: 'u3', festivalId: 'f1', picks: {}, notes: {},
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => useCrew());
      const profiles = result.current.getCrewScopedProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles.map((p) => p.userId)).toEqual(['u1', 'u2']);
    });
  });

  describe('getCrewScopedOtherPicks', () => {
    it('returns empty array when no current profile', () => {
      const { result } = renderHook(() => useCrew());
      expect(result.current.getCrewScopedOtherPicks('set-1')).toEqual([]);
    });

    it('returns picks from crew members excluding current user', () => {
      useCrewStore.setState({
        crewMembers: [
          { id: 'm1', userId: 'u1' },
          { id: 'm2', userId: 'u2' },
        ],
      });
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1', userId: 'u1', festivalId: 'f1', picks: { 'set-1': 'must' },
          notes: {}, updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1', userId: 'u1', festivalId: 'f1', picks: { 'set-1': 'must' },
            notes: {}, updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2', userId: 'u2', festivalId: 'f1', picks: { 'set-1': 'maybe' },
            notes: {}, updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => useCrew());
      const others = result.current.getCrewScopedOtherPicks('set-1');
      expect(others).toHaveLength(1);
      expect(others[0]).toEqual({ profileId: 'p2', priority: 'maybe' });
    });

    it('returns empty when crew member has no pick for the set', () => {
      useCrewStore.setState({
        crewMembers: [
          { id: 'm1', userId: 'u1' },
          { id: 'm2', userId: 'u2' },
        ],
      });
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1', userId: 'u1', festivalId: 'f1', picks: { 'set-1': 'must' },
          notes: {}, updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1', userId: 'u1', festivalId: 'f1', picks: { 'set-1': 'must' },
            notes: {}, updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2', userId: 'u2', festivalId: 'f1', picks: {},
            notes: {}, updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => useCrew());
      expect(result.current.getCrewScopedOtherPicks('set-1')).toEqual([]);
    });

    it('only includes picks from crew members, not all profiles', () => {
      useCrewStore.setState({
        crewMembers: [{ id: 'm1', userId: 'u1' }],
      });
      useFestivalStore.setState({
        currentProfile: {
          id: 'p1', userId: 'u1', festivalId: 'f1', picks: {},
          notes: {}, updatedAt: '2026-01-01T00:00:00Z',
        },
        allProfiles: [
          {
            id: 'p1', userId: 'u1', festivalId: 'f1', picks: {},
            notes: {}, updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'p2', userId: 'u2', festivalId: 'f1', picks: { 'set-1': 'must' },
            notes: {}, updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      });
      const { result } = renderHook(() => useCrew());
      // u2 is not in the crew, so their pick should be excluded
      expect(result.current.getCrewScopedOtherPicks('set-1')).toEqual([]);
    });
  });
});

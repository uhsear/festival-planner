import { describe, it, expect, beforeEach } from 'vitest';
import { useFestivalUIStore } from './festivalUIStore';

describe('festivalUIStore', () => {
  beforeEach(() => {
    useFestivalUIStore.setState({
      selectedDay: 0,
      activeStages: [],
      searchQuery: '',
    });
  });

  describe('initial state', () => {
    it('starts with selectedDay 0', () => {
      expect(useFestivalUIStore.getState().selectedDay).toBe(0);
    });

    it('starts with empty activeStages', () => {
      expect(useFestivalUIStore.getState().activeStages).toEqual([]);
    });

    it('starts with empty searchQuery', () => {
      expect(useFestivalUIStore.getState().searchQuery).toBe('');
    });
  });

  describe('setSelectedDay', () => {
    it('sets the selected day index', () => {
      useFestivalUIStore.getState().setSelectedDay(2);
      expect(useFestivalUIStore.getState().selectedDay).toBe(2);
    });

    it('allows setting to 0', () => {
      useFestivalUIStore.getState().setSelectedDay(3);
      useFestivalUIStore.getState().setSelectedDay(0);
      expect(useFestivalUIStore.getState().selectedDay).toBe(0);
    });
  });

  describe('setActiveStages', () => {
    it('sets the active stage IDs', () => {
      useFestivalUIStore.getState().setActiveStages(['s1', 's2']);
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s1', 's2']);
    });

    it('replaces previous stages', () => {
      useFestivalUIStore.getState().setActiveStages(['s1']);
      useFestivalUIStore.getState().setActiveStages(['s3', 's4']);
      expect(useFestivalUIStore.getState().activeStages).toEqual(['s3', 's4']);
    });

    it('clears with empty array', () => {
      useFestivalUIStore.getState().setActiveStages(['s1']);
      useFestivalUIStore.getState().setActiveStages([]);
      expect(useFestivalUIStore.getState().activeStages).toEqual([]);
    });
  });

  describe('setSearchQuery', () => {
    it('sets the search query', () => {
      useFestivalUIStore.getState().setSearchQuery('deadmau5');
      expect(useFestivalUIStore.getState().searchQuery).toBe('deadmau5');
    });

    it('clears with empty string', () => {
      useFestivalUIStore.getState().setSearchQuery('test');
      useFestivalUIStore.getState().setSearchQuery('');
      expect(useFestivalUIStore.getState().searchQuery).toBe('');
    });
  });
});

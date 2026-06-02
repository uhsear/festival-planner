import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FestivalSet, Stage } from '@festie/shared/types';

// --- Mocks ---------------------------------------------------------------
// useTimelineFilters reads festival data via useFestivalStore selectors and
// the current user's picks via usePicks().getMyPick. We mock ONLY those two
// boundaries and let the real utils (timeToMinutes, getConflictingSetIds,
// artistDisplayName) run, so the filtering/time-bounds logic is exercised
// end-to-end against real implementations.

let storeState: Record<string, unknown>;
const mockGetMyPick = vi.fn<(setId: string) => unknown>();

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

vi.mock('@festie/shared/hooks', () => ({
  usePicks: () => ({ getMyPick: mockGetMyPick }),
}));

import { useTimelineFilters } from './useTimelineFilters';

// --- Fixtures ------------------------------------------------------------

function makeStage(id: string, name = id): Stage {
  return {
    id,
    name,
    festivalId: 'fest-1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeSet(overrides: Partial<FestivalSet> & { id: string }): FestivalSet {
  return {
    festivalId: 'fest-1',
    stageId: 'main',
    dayIndex: 0,
    startTime: '14:00',
    endTime: '15:00',
    artist: 'Artist',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const STAGES = [makeStage('main', 'Main'), makeStage('forest', 'Forest')];

function setStore(overrides: Record<string, unknown> = {}) {
  storeState = {
    currentFestival: { id: 'fest-1', b2bSeparator: ' b2b ' },
    sets: [],
    stages: STAGES,
    selectedDay: 0,
    activeStages: [],
    onlyMine: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMyPick.mockReturnValue(undefined);
  setStore();
});

// --- Day filter ----------------------------------------------------------

describe('useTimelineFilters — day filter', () => {
  it('keeps only sets whose dayIndex matches selectedDay', () => {
    setStore({
      selectedDay: 1,
      sets: [
        makeSet({ id: 'd0', dayIndex: 0 }),
        makeSet({ id: 'd1-a', dayIndex: 1 }),
        makeSet({ id: 'd1-b', dayIndex: 1, startTime: '16:00', endTime: '17:00' }),
        makeSet({ id: 'd2', dayIndex: 2 }),
      ],
    });

    const { result } = renderHook(() => useTimelineFilters());

    const ids = result.current.allDaySets.map((s) => s.id).sort();
    expect(ids).toEqual(['d1-a', 'd1-b']);
  });
});

// --- onlyMine filter -----------------------------------------------------

describe('useTimelineFilters — onlyMine filter', () => {
  it('narrows to sets the user has picked when onlyMine is on', () => {
    setStore({
      onlyMine: true,
      sets: [makeSet({ id: 'picked-1' }), makeSet({ id: 'not-picked' }), makeSet({ id: 'picked-2' })],
    });
    // getMyPick returns truthy only for picked sets.
    mockGetMyPick.mockImplementation((setId: string) =>
      setId === 'picked-1' || setId === 'picked-2' ? 'must' : undefined,
    );

    const { result } = renderHook(() => useTimelineFilters());

    const ids = result.current.allDaySets.map((s) => s.id).sort();
    expect(ids).toEqual(['picked-1', 'picked-2']);
  });

  it('does not filter by picks when onlyMine is off', () => {
    setStore({
      onlyMine: false,
      sets: [makeSet({ id: 'a' }), makeSet({ id: 'b' })],
    });
    mockGetMyPick.mockReturnValue(undefined);

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.allDaySets.map((s) => s.id).sort()).toEqual(['a', 'b']);
  });
});

// --- Stage subset filtering ---------------------------------------------

describe('useTimelineFilters — stage subset filtering', () => {
  it('filters by stage when some-but-not-all stages are active', () => {
    setStore({
      activeStages: ['main'], // 1 of 2 stages → subset filtering applies
      sets: [makeSet({ id: 'on-main', stageId: 'main' }), makeSet({ id: 'on-forest', stageId: 'forest' })],
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.allDaySets.map((s) => s.id)).toEqual(['on-main']);
    // visibleStages reflects the active subset.
    expect(result.current.visibleStages.map((s) => s.id)).toEqual(['main']);
  });

  it('does NOT filter by stage when all stages are active (full set)', () => {
    setStore({
      activeStages: ['main', 'forest'], // all stages → no subset filtering
      sets: [makeSet({ id: 'on-main', stageId: 'main' }), makeSet({ id: 'on-forest', stageId: 'forest' })],
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.allDaySets.map((s) => s.id).sort()).toEqual(['on-forest', 'on-main']);
  });

  it('treats empty activeStages as "all stages active" (no stage filtering)', () => {
    setStore({
      activeStages: [],
      sets: [makeSet({ id: 'on-main', stageId: 'main' }), makeSet({ id: 'on-forest', stageId: 'forest' })],
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.allDaySets.map((s) => s.id).sort()).toEqual(['on-forest', 'on-main']);
    // All stages are visible when none are explicitly selected.
    expect(result.current.visibleStages.map((s) => s.id).sort()).toEqual(['forest', 'main']);
  });
});

// --- timeBounds rounding + overnight ------------------------------------

describe('useTimelineFilters — timeBounds', () => {
  it('returns null when there are no timed sets', () => {
    setStore({
      sets: [makeSet({ id: 'tba', startTime: '', endTime: '' })],
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.timeBounds).toBeNull();
    // The timeless set still appears in allDaySets and timelessSets.
    expect(result.current.timelessSets.map((s) => s.id)).toEqual(['tba']);
    expect(result.current.timedSets).toEqual([]);
  });

  it('rounds min down and max up to the nearest 15-minute slot', () => {
    setStore({
      sets: [
        // 14:07 -> floor to 14:00 (840); 15:53 -> ceil to 16:00 (960)
        makeSet({ id: 's1', startTime: '14:07', endTime: '15:53' }),
      ],
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.timeBounds).toEqual({
      minMin: 14 * 60, // 840
      maxMin: 16 * 60, // 960
      totalSlots: (960 - 840) / 15, // 8
    });
  });

  it('extends an overnight end time past midnight by +24h', () => {
    setStore({
      sets: [
        // 23:00 start, 01:00 end -> end <= start so end += 24h => 25:00 (1500)
        makeSet({ id: 'overnight', startTime: '23:00', endTime: '01:00' }),
      ],
    });

    const { result } = renderHook(() => useTimelineFilters());

    expect(result.current.timeBounds).toEqual({
      minMin: 23 * 60, // 1380
      maxMin: 25 * 60, // 1500 (01:00 + 24h)
      totalSlots: (1500 - 1380) / 15, // 8
    });
  });

  it('spans the earliest start and latest (overnight-adjusted) end across sets', () => {
    setStore({
      sets: [
        makeSet({ id: 'early', startTime: '10:00', endTime: '11:00' }),
        makeSet({ id: 'late-overnight', startTime: '23:30', endTime: '00:30' }),
      ],
    });

    const { result } = renderHook(() => useTimelineFilters());

    // min = 10:00 (600); max = 00:30 + 24h = 24:30 (1470)
    expect(result.current.timeBounds).toEqual({
      minMin: 600,
      maxMin: 1470,
      totalSlots: (1470 - 600) / 15, // 58
    });
  });
});

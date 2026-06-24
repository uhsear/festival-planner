import {
  addStage,
  removeStage,
  setStageField,
  addDay,
  removeDay,
  setDayField,
  toggleDay,
  addSet,
  removeSet,
  setSetField,
  type FormState,
  type SetRow,
  type DayRow,
} from './festivalEditState';

function set(over: Partial<SetRow>): SetRow {
  return { id: 's1', artist: '', stageId: '', startTime: '', endTime: '', linkUrl: '', ...over };
}

function day(over: Partial<DayRow>): DayRow {
  return { id: 'd1', label: '', date: '', sets: [], ...over };
}

function form(over: Partial<FormState>): FormState {
  return { name: '', location: '', timeZone: '', stages: [], days: [], ...over };
}

describe('stage reducers', () => {
  it('addStage appends', () => {
    const f = addStage(form({}), { id: 'st1', name: 'Main', color: '#fff' });
    expect(f.stages.map((s) => s.id)).toEqual(['st1']);
  });
  it('removeStage drops only the matching id', () => {
    const f = form({ stages: [{ id: 'a', name: '', color: '' }, { id: 'b', name: '', color: '' }] });
    expect(removeStage(f, 'a').stages.map((s) => s.id)).toEqual(['b']);
  });
  it('setStageField edits the right field on the right stage', () => {
    const f = form({ stages: [{ id: 'a', name: 'x', color: '#000' }] });
    const next = setStageField(f, 'a', 'name', 'Renamed');
    expect(next.stages[0]).toEqual({ id: 'a', name: 'Renamed', color: '#000' });
  });
});

describe('day reducers', () => {
  it('addDay appends', () => {
    const f = addDay(form({}), day({ id: 'd9' }));
    expect(f.days.map((d) => d.id)).toEqual(['d9']);
  });
  it('removeDay drops only the matching day', () => {
    const f = form({ days: [day({ id: 'A' }), day({ id: 'B' })] });
    expect(removeDay(f, 'A').days.map((d) => d.id)).toEqual(['B']);
  });
  it('setDayField edits the right day', () => {
    const f = form({ days: [day({ id: 'A', label: 'old' }), day({ id: 'B', label: 'keep' })] });
    const next = setDayField(f, 'A', 'label', 'new');
    expect(next.days.map((d) => d.label)).toEqual(['new', 'keep']);
  });
});

describe('toggleDay', () => {
  it('adds a dayId not yet expanded', () => {
    expect(toggleDay(new Set<string>(), 'd1').has('d1')).toBe(true);
  });
  it('removes a dayId already expanded', () => {
    expect(toggleDay(new Set(['d1']), 'd1').has('d1')).toBe(false);
  });
  it('returns a new Set (does not mutate the input)', () => {
    const prev = new Set(['d1']);
    const next = toggleDay(prev, 'd2');
    expect(next).not.toBe(prev);
    expect([...prev]).toEqual(['d1']); // untouched
    expect([...next].sort()).toEqual(['d1', 'd2']);
  });
});

describe('addSet — add to day A does not touch day B', () => {
  it('appends to the targeted day only', () => {
    const f = form({ days: [day({ id: 'A', sets: [] }), day({ id: 'B', sets: [set({ id: 'b1' })] })] });
    const next = addSet(f, 'A', set({ id: 'a1' }));
    expect(next.days.find((d) => d.id === 'A')!.sets.map((s) => s.id)).toEqual(['a1']);
    expect(next.days.find((d) => d.id === 'B')!.sets.map((s) => s.id)).toEqual(['b1']);
  });
  it('leaves the untouched day referentially equal (structural sharing)', () => {
    const dayB = day({ id: 'B', sets: [set({ id: 'b1' })] });
    const f = form({ days: [day({ id: 'A' }), dayB] });
    const next = addSet(f, 'A', set({ id: 'a1' }));
    expect(next.days.find((d) => d.id === 'B')).toBe(dayB);
  });
});

describe('removeSet — removes only (dayId,setId)', () => {
  it('removes the matching set under the matching day', () => {
    const f = form({ days: [day({ id: 'A', sets: [set({ id: 's1' }), set({ id: 's2' })] })] });
    expect(removeSet(f, 'A', 's1').days[0].sets.map((s) => s.id)).toEqual(['s2']);
  });
  it('does NOT remove a set with the same id under a different day', () => {
    const f = form({
      days: [day({ id: 'A', sets: [set({ id: 'dup' })] }), day({ id: 'B', sets: [set({ id: 'dup' })] })],
    });
    const next = removeSet(f, 'A', 'dup');
    expect(next.days.find((d) => d.id === 'A')!.sets).toEqual([]);
    expect(next.days.find((d) => d.id === 'B')!.sets.map((s) => s.id)).toEqual(['dup']);
  });
});

describe('setSetField — edits the right one across duplicated setIds', () => {
  it('edits only the set under the targeted day, even when setIds collide', () => {
    const f = form({
      days: [
        day({ id: 'A', sets: [set({ id: 'dup', artist: 'A-orig' })] }),
        day({ id: 'B', sets: [set({ id: 'dup', artist: 'B-orig' })] }),
      ],
    });
    const next = setSetField(f, 'B', 'dup', 'artist', 'B-edited');
    expect(next.days.find((d) => d.id === 'A')!.sets[0].artist).toBe('A-orig');
    expect(next.days.find((d) => d.id === 'B')!.sets[0].artist).toBe('B-edited');
  });
  it('updates an arbitrary SetRow field', () => {
    const f = form({ days: [day({ id: 'A', sets: [set({ id: 's1', stageId: '' })] })] });
    expect(setSetField(f, 'A', 's1', 'stageId', 'stage-7').days[0].sets[0].stageId).toBe('stage-7');
  });
});

/**
 * Mobile-local pure reducers for the admin Festival editor (app/admin/festival-edit.tsx).
 *
 * These are the nested-tree transforms the editor applies to its FormState as
 * the admin edits stages, days, and the sets nested under each day. They're
 * lifted out of the component so the tricky structural-sharing branches —
 * "edit day A's sets without touching day B", "remove exactly (dayId,setId)",
 * "update the right set even when setIds are duplicated across days" — can be
 * unit-tested without rendering the screen. All functions are pure: they take
 * the prior FormState and return a new one (the component still owns useState).
 *
 * These shapes mirror the web form's Festival/Day/SetRow and the editor's local
 * interfaces; kept local (not in @festie/shared) because they're the editor's
 * editable view-model, not domain types.
 */

export interface StageRow {
  id: string;
  name: string;
  color: string;
}

export interface SetRow {
  id: string;
  artist: string;
  stageId: string;
  /** '' or 'TBA' is the permitted fallback; the field renders it as blank. */
  startTime: string;
  endTime: string;
  /** Optional spotify/soundcloud URL — sent as linkUrl (server normalizes it). */
  linkUrl: string;
}

export interface DayRow {
  id: string;
  label: string;
  date: string;
  sets: SetRow[];
}

export interface FormState {
  name: string;
  location: string;
  timeZone: string; // '' = device-local (no festival zone)
  stages: StageRow[];
  days: DayRow[];
}

// ── Stage editing ───────────────────────────────────────────────────────────
export function addStage(f: FormState, newStage: StageRow): FormState {
  return { ...f, stages: [...f.stages, newStage] };
}

export function removeStage(f: FormState, stageId: string): FormState {
  return { ...f, stages: f.stages.filter((s) => s.id !== stageId) };
}

export function setStageField(f: FormState, stageId: string, field: 'name' | 'color', value: string): FormState {
  return {
    ...f,
    stages: f.stages.map((s) => (s.id === stageId ? { ...s, [field]: value } : s)),
  };
}

// ── Day editing ───────────────────────────────────────────────────────────--
export function addDay(f: FormState, newDay: DayRow): FormState {
  return { ...f, days: [...f.days, newDay] };
}

export function removeDay(f: FormState, dayId: string): FormState {
  return { ...f, days: f.days.filter((d) => d.id !== dayId) };
}

export function setDayField(f: FormState, dayId: string, field: 'label' | 'date', value: string): FormState {
  return {
    ...f,
    days: f.days.map((d) => (d.id === dayId ? { ...d, [field]: value } : d)),
  };
}

/**
 * Toggle a dayId's membership in the expanded-days set, returning a NEW set
 * (the editor stores expanded state separately from FormState).
 */
export function toggleDay(expanded: Set<string>, dayId: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(dayId)) next.delete(dayId);
  else next.add(dayId);
  return next;
}

// ── Set editing (nested under each day) ───────────────────────────────────--
/**
 * Append a new set to ONE day. Days other than `dayId` are returned by
 * reference (untouched), so adding to day A never disturbs day B.
 */
export function addSet(f: FormState, dayId: string, newSet: SetRow): FormState {
  return {
    ...f,
    days: f.days.map((d) => (d.id === dayId ? { ...d, sets: [...d.sets, newSet] } : d)),
  };
}

/**
 * Remove exactly the set matching BOTH dayId and setId. A set with the same
 * setId living under a different day is left intact.
 */
export function removeSet(f: FormState, dayId: string, setId: string): FormState {
  return {
    ...f,
    days: f.days.map((d) => (d.id === dayId ? { ...d, sets: d.sets.filter((s) => s.id !== setId) } : d)),
  };
}

/**
 * Update one field on the set matching BOTH dayId and setId — so a setId that
 * happens to be duplicated across days only changes the one under `dayId`.
 */
export function setSetField(
  f: FormState,
  dayId: string,
  setId: string,
  field: keyof SetRow,
  value: string,
): FormState {
  return {
    ...f,
    days: f.days.map((d) =>
      d.id === dayId ? { ...d, sets: d.sets.map((s) => (s.id === setId ? { ...s, [field]: value } : s)) } : d,
    ),
  };
}

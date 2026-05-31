/**
 * Client-side ICS (RFC 5545) calendar generation, ported from the backend
 * lib/helpers/ics-builder.ts so mobile (and later web) can export a user's
 * picks to a .ics file fully offline — no server round-trip, no native module.
 *
 * Times are emitted as floating local time (`YYYYMMDDTHHMMSS`, no Z / TZID),
 * matching the backend export: festival schedules are venue-local and must not
 * shift by the device's UTC offset.
 */
import type { FestivalSet, Stage, Priority } from '../types';

/** Escape a value for an ICS TEXT property (RFC 5545). */
export function escIcs(v: unknown): string {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/** Validate an HH:MM time; returns the string if valid, else null. */
export function validateIcsTime(t: unknown): string | null {
  if (typeof t !== 'string' || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number) as [number, number];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return t;
}

/** Fold a content line per RFC 5545 (max 75 octets per line). */
export function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  let folded = line.substring(0, 75);
  let rest = line.substring(75);
  while (rest.length > 0) {
    folded += '\r\n ' + rest.substring(0, 74);
    rest = rest.substring(74);
  }
  return folded;
}

export interface IcsEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  location?: string;
  description?: string;
  dtstamp?: string;
  sequence?: number;
}

/** Build a single VEVENT block. */
export function buildVEvent(ev: IcsEvent): string[] {
  const stamp = ev.dtstamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VEVENT',
    `DTSTAMP:${stamp}`,
    `DTSTART:${ev.dtstart}`,
    `DTEND:${ev.dtend}`,
    foldIcsLine(`SUMMARY:${escIcs(ev.summary)}`),
  ];
  if (ev.location) lines.push(foldIcsLine(`LOCATION:${escIcs(ev.location)}`));
  if (ev.description) lines.push(foldIcsLine(`DESCRIPTION:${escIcs(ev.description)}`));
  lines.push(`UID:${ev.uid}`);
  lines.push('STATUS:CONFIRMED');
  if (ev.sequence !== undefined) lines.push(`SEQUENCE:${ev.sequence}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Build a complete VCALENDAR string from event descriptors. */
export function buildVCalendar(
  events: IcsEvent[],
  opts: { calendarName?: string; prodId?: string } = {},
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${opts.prodId || '-//Festie//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldIcsLine(`X-WR-CALNAME:${escIcs(opts.calendarName)}`),
  ];
  for (const event of events) {
    for (const line of buildVEvent(event)) lines.push(line);
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function setArtistLabel(set: FestivalSet): string {
  if (set.artist) return set.artist;
  if (set.artists && set.artists.length > 0) {
    return set.artists.map((a) => a.name).filter(Boolean).join(' b2b ');
  }
  return 'Set';
}

/**
 * Build a .ics for the picks in `picks`, using the already-loaded (flattened)
 * shared store data: `sets` carry `date` from their day, `stages` map ids to
 * names, `picks`/`notes` come from the current profile. Sets without a valid
 * date or HH:MM start/end are skipped so the calendar stays valid.
 */
export function buildPicksIcs(opts: {
  festival: { id: string; name?: string; location?: string };
  sets: FestivalSet[];
  stages: Stage[];
  picks: Record<string, Priority>;
  notes?: Record<string, string>;
  origin?: string;
}): string {
  const { festival, sets, stages, picks, notes = {}, origin = 'festie.us' } = opts;
  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const events: IcsEvent[] = [];

  for (const set of sets) {
    if (!picks[set.id]) continue;
    if (!set.date || !/^\d{4}-\d{2}-\d{2}$/.test(set.date)) continue;
    const startTime = validateIcsTime(set.startTime);
    const endTime = validateIcsTime(set.endTime);
    if (!startTime || !endTime) continue;

    const stage = stageMap.get(set.stageId);
    const dtstart = set.date.replace(/-/g, '') + 'T' + startTime.replace(':', '') + '00';
    const dtend = set.date.replace(/-/g, '') + 'T' + endTime.replace(':', '') + '00';
    const priority = picks[set.id] || '';
    const note = notes[set.id] || '';
    const description = [priority && `Priority: ${priority}`, note].filter(Boolean).join('\\n');
    const location = stage
      ? stage.name + (festival.location ? ' - ' + festival.location : '')
      : undefined;

    events.push({
      uid: `${set.id}-${festival.id}@${origin}`,
      summary: setArtistLabel(set),
      dtstart,
      dtend,
      location,
      description: description || undefined,
    });
  }

  return buildVCalendar(events, { calendarName: `${festival.name || 'Festival'} — My Picks` });
}

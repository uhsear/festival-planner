// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.

/**
 * Shared ICS (RFC 5545) calendar generation utilities.
 * Used by both the one-off export route and the subscribable calendar feed.
 */

/**
 * Escape a value for use in an ICS property (RFC 5545 TEXT escaping).
 */
export function escIcs(v: any) {
  return String(v || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

/**
 * Validate a time string in HH:MM format. Returns the string if valid, null otherwise.
 */
export function validateIcsTime(t: any) {
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return t;
}

/**
 * Fold a content line per RFC 5545 (max 75 octets per line).
 */
export function foldIcsLine(line: any) {
  if (line.length <= 75) return line;
  let folded = line.substring(0, 75);
  let rest = line.substring(75);
  while (rest.length > 0) {
    folded += '\r\n ' + rest.substring(0, 74);
    rest = rest.substring(74);
  }
  return folded;
}

/**
 * Build a single VEVENT block from an event descriptor.
 */
export function buildVEvent({ uid, summary, dtstart, dtend, location, description, dtstamp, sequence }: any) {
  const stamp = dtstamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VEVENT',
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    foldIcsLine(`SUMMARY:${escIcs(summary)}`),
  ];
  if (location) lines.push(foldIcsLine(`LOCATION:${escIcs(location)}`));
  if (description) lines.push(foldIcsLine(`DESCRIPTION:${escIcs(description)}`));
  lines.push(`UID:${uid}`);
  lines.push('STATUS:CONFIRMED');
  if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Build a complete VCALENDAR string from an array of event descriptors.
 */
export function buildVCalendar(events: any, { calendarName, prodId, extraHeaders }: any = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId || '-//FestivalPlanner//EN'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldIcsLine(`X-WR-CALNAME:${escIcs(calendarName)}`),
  ];

  if (extraHeaders) {
    for (const header of extraHeaders) lines.push(header);
  }

  for (const event of events) {
    const veventLines = buildVEvent(event);
    for (const line of veventLines) lines.push(line);
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Transform a festival + profile into an array of ICS event descriptors
 * suitable for `buildVCalendar`. Shared by the one-off export route and the
 * subscribable calendar-sync feed.
 */
export function buildIcsEventsFromPicks(festival: any, profile: any, origin: string) {
  const picks = profile.picks || {};
  const notes = profile.notes || {};
  const sets = (festival.days || []).flatMap((day: any) =>
    (day.sets || []).filter((s: any) => picks[s.id]).map((s: any) => ({ ...s, date: day.date, dayLabel: day.label }))
  );
  const stageMap = new Map<string, any>((festival.stages || []).map((s: any) => [s.id, s]));

  const events = [];
  for (const set of sets) {
    if (!set.date || !/^\d{4}-\d{2}-\d{2}$/.test(set.date) || !set.startTime || !set.endTime) continue;
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
      summary: set.artist,
      dtstart,
      dtend,
      location,
      description: description || undefined,
    });
  }
  return events;
}

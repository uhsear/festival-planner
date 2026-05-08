// Copyright (c) 2026 Asir Khan. All rights reserved.
// Licensed under the Business Source License 1.1. See LICENSE file for details.
'use strict';

/**
 * Shared ICS (RFC 5545) calendar generation utilities.
 * Used by both the one-off export route and the subscribable calendar feed.
 */

/**
 * Escape a value for use in an ICS property (RFC 5545 TEXT escaping).
 */
function escIcs(v) {
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
function validateIcsTime(t) {
  if (!/^\d{2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return t;
}

/**
 * Fold a content line per RFC 5545 (max 75 octets per line).
 */
function foldIcsLine(line) {
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
 * @param {object} event
 * @param {string} event.uid
 * @param {string} event.summary
 * @param {string} event.dtstart  - e.g. "20260605T143000"
 * @param {string} event.dtend    - e.g. "20260605T153000"
 * @param {string} [event.location]
 * @param {string} [event.description]
 * @param {string} [event.dtstamp] - defaults to now
 * @param {number} [event.sequence]
 * @returns {string[]} Array of ICS lines for this VEVENT
 */
function buildVEvent({ uid, summary, dtstart, dtend, location, description, dtstamp, sequence }) {
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
 * @param {object[]} events - Array of event objects (see buildVEvent params)
 * @param {object} opts
 * @param {string} opts.calendarName - X-WR-CALNAME value
 * @param {string} [opts.prodId]     - PRODID (default: -//FestivalPlanner//EN)
 * @param {string[]} [opts.extraHeaders] - Additional header lines (e.g. refresh hints)
 * @returns {string} Complete ICS content
 */
function buildVCalendar(events, { calendarName, prodId, extraHeaders } = {}) {
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

module.exports = { escIcs, foldIcsLine, validateIcsTime, buildVCalendar, buildVEvent };

import { describe, it, expect } from 'vitest';
import { parseLineupCsv } from './lineupCsv';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csv(...rows: string[]): string {
  return rows.join('\n');
}

const HEADER = 'dayLabel,date,artist,stage';
const FULL_HEADER = 'dayLabel,date,artist,stage,startTime,endTime,stageColor';

// ---------------------------------------------------------------------------
// Happy-path parsing
// ---------------------------------------------------------------------------

describe('parseLineupCsv — happy path', () => {
  it('parses a minimal valid CSV', () => {
    const input = csv(HEADER, 'Friday,2026-09-04,Bonobo,Main Stage');
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      dayLabel: 'Friday',
      date: '2026-09-04',
      artist: 'Bonobo',
      stage: 'Main Stage',
      startTime: undefined,
      endTime: undefined,
      stageColor: undefined,
    });
  });

  it('parses a row with all optional columns', () => {
    const input = csv(FULL_HEADER, 'Friday,2026-09-04,Bonobo,Main Stage,20:00,22:00,#00bcd4');
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    const row = rows[0]!;
    expect(row.startTime).toBe('20:00');
    expect(row.endTime).toBe('22:00');
    expect(row.stageColor).toBe('#00bcd4');
  });

  it('parses multiple data rows', () => {
    const input = csv(
      HEADER,
      'Friday,2026-09-04,Bonobo,Main Stage',
      'Saturday,2026-09-05,Four Tet,Tent Stage',
      'Sunday,2026-09-06,Jon Hopkins,Pyramid',
    );
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    expect(rows[1]!.artist).toBe('Four Tet');
  });

  it('trims whitespace from field values', () => {
    const input = csv(HEADER, '  Friday , 2026-09-04 , Bonobo , Main Stage ');
    const { rows } = parseLineupCsv(input);
    expect(rows[0]!.dayLabel).toBe('Friday');
    expect(rows[0]!.date).toBe('2026-09-04');
    expect(rows[0]!.artist).toBe('Bonobo');
    expect(rows[0]!.stage).toBe('Main Stage');
  });

  it('handles CRLF line endings', () => {
    const input = `${HEADER}\r\nFriday,2026-09-04,Bonobo,Main Stage\r\n`;
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it('ignores blank lines between rows', () => {
    const input = `${HEADER}\n\nFriday,2026-09-04,Bonobo,Main Stage\n\n`;
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it('defaults stage to "Main Stage" when stage column is empty', () => {
    const input = csv(HEADER, 'Friday,2026-09-04,Bonobo,');
    const { rows } = parseLineupCsv(input);
    expect(rows[0]!.stage).toBe('Main Stage');
  });
});

// ---------------------------------------------------------------------------
// Quoted-field CSV parsing
// ---------------------------------------------------------------------------

describe('parseLineupCsv — quoted fields', () => {
  it('handles a quoted artist name containing a comma', () => {
    const input = csv(HEADER, 'Friday,2026-09-04,"Smith, Elliot",Main Stage');
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows[0]!.artist).toBe('Smith, Elliot');
  });

  it('handles escaped double-quotes inside quoted fields', () => {
    const input = csv(HEADER, 'Friday,2026-09-04,"DJ ""Tiesto""",Main Stage');
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows[0]!.artist).toBe('DJ "Tiesto"');
  });

  it('handles a quoted stage name containing a comma', () => {
    const input = csv(HEADER, 'Friday,2026-09-04,Bonobo,"Main Stage, East"');
    const { rows } = parseLineupCsv(input);
    expect(rows[0]!.stage).toBe('Main Stage, East');
  });
});

// ---------------------------------------------------------------------------
// Edge cases — empty / malformed input
// ---------------------------------------------------------------------------

describe('parseLineupCsv — empty / malformed', () => {
  it('errors on empty string', () => {
    const { rows, errors } = parseLineupCsv('');
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/header/i);
  });

  it('errors on header-only CSV (no data rows)', () => {
    const { rows, errors } = parseLineupCsv(HEADER);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('errors when required columns are missing from header', () => {
    const { rows, errors } = parseLineupCsv('artist,stage\nBonobo,Main Stage');
    expect(rows).toHaveLength(0);
    expect(errors[0]).toMatch(/missing required columns/i);
    expect(errors[0]).toMatch(/dayLabel/i);
    expect(errors[0]).toMatch(/date/i);
  });

  it('errors when ALL required columns are absent', () => {
    const { errors } = parseLineupCsv('foo,bar\n1,2');
    expect(errors[0]).toMatch(/missing required columns/i);
  });

  it('skips rows with missing artist and reports skipped count', () => {
    const input = csv(
      HEADER,
      'Friday,2026-09-04,,Main Stage',
      'Friday,2026-09-04,Bonobo,Main Stage',
    );
    const { rows, errors } = parseLineupCsv(input);
    expect(rows).toHaveLength(1);
    expect(errors.some((e) => /skipped/i.test(e))).toBe(true);
    expect(errors.some((e) => /1 row/i.test(e))).toBe(true);
  });

  it('reports an error for rows missing dayLabel or date but with an artist', () => {
    const input = csv(HEADER, ',2026-09-04,Bonobo,Main Stage', ',,Bonobo,Main Stage');
    const { errors } = parseLineupCsv(input);
    expect(errors.some((e) => /missing day label or date/i.test(e))).toBe(true);
  });

  it('handles a CSV where every data row is empty-artist (all skipped)', () => {
    const input = csv(HEADER, 'Friday,2026-09-04,,Main Stage', 'Saturday,2026-09-05,,Tent');
    const { rows, errors } = parseLineupCsv(input);
    expect(rows).toHaveLength(0);
    expect(errors.some((e) => /2 rows skipped/i.test(e))).toBe(true);
  });

  it('does not error for a row with an artist but missing optional columns', () => {
    const input = csv(FULL_HEADER, 'Friday,2026-09-04,Bonobo,Main Stage,,,');
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows[0]!.startTime).toBe('');
    expect(rows[0]!.endTime).toBe('');
    expect(rows[0]!.stageColor).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Large input / performance sanity
// ---------------------------------------------------------------------------

describe('parseLineupCsv — larger inputs', () => {
  it('parses 500 rows without error', () => {
    const dataRows = Array.from(
      { length: 500 },
      (_, i) => `Friday,2026-09-04,Artist ${i},Stage ${i % 5}`,
    );
    const input = csv(HEADER, ...dataRows);
    const { rows, errors } = parseLineupCsv(input);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(500);
  });
});

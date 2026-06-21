export interface LineupRow {
  dayLabel: string;
  date: string;
  artist: string;
  stage: string;
  startTime?: string;
  endTime?: string;
  stageColor?: string;
}

export interface ParseLineupCsvResult {
  rows: LineupRow[];
  errors: string[];
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

export function parseLineupCsv(text: string): ParseLineupCsvResult {
  const rows: LineupRow[] = [];
  const errors: string[] = [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    errors.push('CSV must include a header and at least one set row');
    return { rows, errors };
  }

  const header = parseCsvLine(lines[0]!).map((h) => h.trim());
  const required = ['dayLabel', 'date', 'artist', 'stage'];

  const missingColumns = required.filter((col) => !header.includes(col));
  if (missingColumns.length > 0) {
    errors.push(`Missing required columns: ${missingColumns.join(', ')}`);
    return { rows, errors };
  }

  const indexes: Record<string, number> = {};
  header.forEach((col, i) => {
    indexes[col] = i;
  });

  let skippedCount = 0;

  lines.slice(1).forEach((line, lineNum) => {
    const values = parseCsvLine(line);

    const dayLabel = (values[indexes['dayLabel']!] || '').trim();
    const date = (values[indexes['date']!] || '').trim();
    const artist = (values[indexes['artist']!] || '').trim();
    const stage = (values[indexes['stage']!] || '').trim();

    if (!artist) {
      skippedCount++;
      return;
    }

    if (!dayLabel || !date) {
      errors.push(`Row ${lineNum + 2}: Missing day label or date`);
      return;
    }

    rows.push({
      dayLabel,
      date,
      artist,
      stage: stage || 'Main Stage',
      startTime: indexes.startTime !== undefined ? (values[indexes.startTime] || '').trim() : undefined,
      endTime: indexes.endTime !== undefined ? (values[indexes.endTime] || '').trim() : undefined,
      stageColor: indexes.stageColor !== undefined ? (values[indexes.stageColor] || '').trim() : undefined,
    });
  });

  if (skippedCount > 0) {
    errors.push(`${skippedCount} rows skipped (missing required field: artist)`);
  }

  return { rows, errors };
}

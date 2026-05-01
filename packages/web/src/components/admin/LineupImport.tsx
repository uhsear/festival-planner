import React, { useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

interface LineupImportProps {
  festivalId: string;
  onSuccess?: () => void;
}

interface ParsedSet {
  dayLabel: string;
  date: string;
  artist: string;
  stage: string;
  startTime?: string;
  endTime?: string;
  stageColor?: string;
}

/**
 * CSV/TSV lineup import component with preview and error handling
 */
export default function LineupImport({ festivalId, onSuccess }: LineupImportProps) {
  const [importText, setImportText] = useState('');
  const [preview, setPreview] = useState<ParsedSet[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const parseCsvLine = (line: string): string[] => {
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
  };

  const handleParse = () => {
    setErrors([]);
    setPreview([]);

    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      setErrors(['CSV must include a header and at least one set row']);
      return;
    }

    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const required = ['dayLabel', 'date', 'artist', 'stage'];

    const missingColumns = required.filter((col) => !header.includes(col));
    if (missingColumns.length > 0) {
      setErrors([`Missing required columns: ${missingColumns.join(', ')}`]);
      return;
    }

    const indexes: Record<string, number> = {};
    header.forEach((col, i) => {
      indexes[col] = i;
    });

    const parsedSets: ParsedSet[] = [];
    const newErrors: string[] = [];
    let skippedCount = 0;

    lines.slice(1).forEach((line, lineNum) => {
      const values = parseCsvLine(line);

      const dayLabel = (values[indexes.dayLabel] || '').trim();
      const date = (values[indexes.date] || '').trim();
      const artist = (values[indexes.artist] || '').trim();
      const stage = (values[indexes.stage] || '').trim();

      if (!artist) {
        skippedCount++;
        return;
      }

      if (!dayLabel || !date) {
        newErrors.push(`Row ${lineNum + 2}: Missing day label or date`);
        return;
      }

      parsedSets.push({
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
      newErrors.push(`${skippedCount} rows skipped (missing required field: artist)`);
    }

    setPreview(parsedSets);
    if (newErrors.length > 0) {
      setErrors(newErrors);
    }
  };

  const handleImport = async () => {
    if (preview.length === 0) {
      toast('No valid sets to import', 'error');
      return;
    }

    try {
      setLoading(true);
      await api.post<void>(`/admin/festivals/${festivalId}/import-lineup`, { sets: preview });

      toast(`Imported ${preview.length} sets`, 'success');
      setImportText('');
      setPreview([]);
      setErrors([]);
      onSuccess?.();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-3">Import Lineup from CSV/TSV</h2>

        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 mb-4">
          <p className="text-sm text-text-muted mb-3">
            Required columns: <code className="bg-bg-primary/50 px-1.5 py-0.5 rounded text-xs">dayLabel date artist stage</code>
          </p>
          <p className="text-sm text-text-muted">
            Optional columns: <code className="bg-bg-primary/50 px-1.5 py-0.5 rounded text-xs">startTime endTime stageColor</code>
          </p>
        </div>

        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste CSV or TSV data here..."
          rows={8}
          className="w-full px-4 py-3 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />

        <button
          onClick={handleParse}
          className="mt-3 px-4 py-2 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
        >
          Parse & Preview
        </button>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-accent-coral/20 border border-accent-coral/30 rounded-lg p-4">
          <h4 className="font-semibold text-accent-coral mb-2">Issues Found</h4>
          <ul className="space-y-1">
            {errors.map((error, i) => (
              <li key={i} className="text-sm text-accent-coral">
                • {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div>
          <h4 className="font-semibold text-text-primary mb-3">Preview ({preview.length} sets)</h4>
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-glass-border">
                    <th className="px-4 py-2 text-left text-text-muted font-medium">Day</th>
                    <th className="px-4 py-2 text-left text-text-muted font-medium">Date</th>
                    <th className="px-4 py-2 text-left text-text-muted font-medium">Artist</th>
                    <th className="px-4 py-2 text-left text-text-muted font-medium">Stage</th>
                    <th className="px-4 py-2 text-left text-text-muted font-medium">Start</th>
                    <th className="px-4 py-2 text-left text-text-muted font-medium">End</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-glass-border">
                  {preview.slice(0, 20).map((set, i) => (
                    <tr key={i} className="hover:bg-bg-primary/20 transition-colors">
                      <td className="px-4 py-2 text-text-primary">{set.dayLabel}</td>
                      <td className="px-4 py-2 text-text-primary">{set.date}</td>
                      <td className="px-4 py-2 text-text-primary">{set.artist}</td>
                      <td className="px-4 py-2 text-text-primary">{set.stage}</td>
                      <td className="px-4 py-2 text-text-secondary text-xs">{set.startTime || '—'}</td>
                      <td className="px-4 py-2 text-text-secondary text-xs">{set.endTime || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.length > 20 && (
              <div className="px-4 py-3 bg-bg-primary/20 text-center text-xs text-text-muted">
                Showing 20 of {preview.length} sets
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end mt-4">
            <button
              onClick={() => {
                setImportText('');
                setPreview([]);
              }}
              className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium"
            >
              Clear
            </button>
            <button
              onClick={handleImport}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 disabled:opacity-50 transition-opacity text-sm font-medium inline-flex items-center gap-2"
            >
              {loading && (
                <span
                  aria-hidden="true"
                  className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin"
                />
              )}
              {loading ? `Importing ${preview.length} sets…` : `Import ${preview.length} Set${preview.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

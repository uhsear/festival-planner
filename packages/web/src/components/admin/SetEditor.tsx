export interface SetRow {
  id: string;
  artist?: string;
  stageId?: string;
  startTime?: string | null;
  endTime?: string | null;
  artists?: Array<{ name: string; id?: string }>;
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  name: string;
  color: string;
}

export interface SetEditorProps {
  set: SetRow;
  stages: Stage[];
  onField: (field: string, value: string | null) => void;
  onRemove: () => void;
}

/**
 * Edits one set row (artist, stage, startTime, endTime) inside a day.
 */
export default function SetEditor({ set: s, stages, onField, onRemove }: SetEditorProps) {
  return (
    <div className="grid grid-cols-[1fr_140px_90px_90px_auto] gap-2">
      <input
        type="text"
        placeholder="Artist name"
        aria-label="Artist name"
        value={s.artist || ''}
        onChange={(e) => onField('artist', e.target.value)}
        className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-aqua"
      />
      <select
        value={s.stageId || ''}
        aria-label="Stage"
        onChange={(e) => onField('stageId', e.target.value)}
        className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
      >
        <option value="">— Stage —</option>
        {stages.map((st) => (
          <option key={st.id} value={st.id}>
            {st.name || st.id}
          </option>
        ))}
      </select>
      <input
        type="time"
        aria-label="Start time"
        value={s.startTime && s.startTime !== 'TBA' ? s.startTime : ''}
        onChange={(e) => onField('startTime', e.target.value || 'TBA')}
        className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
      />
      <input
        type="time"
        aria-label="End time"
        value={s.endTime && s.endTime !== 'TBA' ? s.endTime : ''}
        onChange={(e) => onField('endTime', e.target.value || null)}
        className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
      />
      <button
        type="button"
        onClick={onRemove}
        className="px-2 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
        aria-label={`Remove ${s.artist || 'artist'}`}
      >
        ×
      </button>
    </div>
  );
}

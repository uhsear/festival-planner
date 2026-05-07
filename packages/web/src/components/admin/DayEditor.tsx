import SetEditor, { SetRow, Stage } from './SetEditor';

export interface Day {
  id: string;
  label: string;
  date: string;
  sets: SetRow[];
}

export interface DayEditorProps {
  day: Day;
  stages: Stage[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onLabelChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onRemoveDay: () => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onSetField: (setId: string, field: string, value: string | null) => void;
}

/**
 * One day row with expand/collapse toggle and the sets list for that day.
 */
export default function DayEditor({
  day,
  stages,
  isExpanded,
  onToggleExpand,
  onLabelChange,
  onDateChange,
  onRemoveDay,
  onAddSet,
  onRemoveSet,
  onSetField,
}: DayEditorProps) {
  const setCount = (day.sets || []).length;

  return (
    <div className="rounded-lg bg-bg-primary/40 border border-glass-border">
      {/* Day header row */}
      <div className="flex gap-2 items-center p-3">
        <button
          type="button"
          onClick={onToggleExpand}
          className="px-2 py-1 rounded bg-bg-card text-text-secondary hover:text-text-primary text-sm font-mono min-w-[32px]"
          aria-label={isExpanded ? 'Collapse day' : 'Expand day'}
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? '▼' : '▶'}
        </button>
        <input
          type="text"
          placeholder="Day label"
          value={day.label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <input
          type="date"
          value={day.date}
          onChange={(e) => onDateChange(e.target.value)}
          className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <span className="text-xs text-text-muted whitespace-nowrap">
          {setCount} {setCount === 1 ? 'artist' : 'artists'}
        </span>
        <button
          onClick={onRemoveDay}
          className="px-2 py-2 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
        >
          Remove
        </button>
      </div>

      {/* Expanded: artists/sets list */}
      {isExpanded && (
        <div className="border-t border-glass-border p-3 space-y-2">
          {setCount === 0 ? (
            <p className="text-xs text-text-muted italic">
              No artists yet. Click "Add Artist" to add one, or use the Import Lineup tab.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_140px_90px_90px_auto] gap-2 text-xs text-text-muted px-1">
                <div>Artist</div>
                <div>Stage</div>
                <div>Start</div>
                <div>End</div>
                <div></div>
              </div>
              {(day.sets || []).map((s) => (
                <SetEditor
                  key={s.id}
                  set={s}
                  stages={stages}
                  onField={(field, value) => onSetField(s.id, field, value)}
                  onRemove={() => onRemoveSet(s.id)}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onAddSet}
            className="mt-2 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
          >
            + Add Artist
          </button>
        </div>
      )}
    </div>
  );
}

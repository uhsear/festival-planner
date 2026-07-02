import React, { useState } from 'react';
import DayEditor, { Day } from './DayEditor';
import { Stage } from './SetEditor';

export interface Festival {
  id?: string;
  name?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  b2bSeparator?: string;
  /** Optional IANA zone — anchors set status + reminders in the festival's zone. */
  timeZone?: string | null;
  stages?: Stage[];
  days?: Day[];
  [key: string]: unknown;
}

// Common IANA zones offered in the festival editor. The festival's current
// value is merged in at render time so an existing custom zone is never dropped.
const COMMON_TIME_ZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Australia/Sydney',
];

export interface FestivalEditFormProps {
  formData: Partial<Festival>;
  setFormData: (next: Partial<Festival>) => void;
  editingId: string | null;
  initialExpandedDays?: Set<string>;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Edit form for a festival's top-level fields plus its stages and days.
 *
 * Delegates per-day rendering (including artists) to DayEditor, and per-set
 * editing to SetEditor. Pure presentation over the parent's formData state —
 * API calls live in AdminFestivals.
 */
export default function FestivalEditForm({
  formData,
  setFormData,
  editingId,
  initialExpandedDays,
  onSave,
  onCancel,
}: FestivalEditFormProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(initialExpandedDays ?? new Set());

  const toggleDayExpanded = (dayId: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  // ── Stages ────────────────────────────────────────────────────
  const handleAddStage = () => {
    setFormData({
      ...formData,
      stages: [...(formData.stages || []), { id: `stage-${Date.now()}`, name: '', color: '#6a6a88' }],
    });
  };

  const handleRemoveStage = (stageId: string) => {
    setFormData({
      ...formData,
      stages: formData.stages?.filter((s) => s.id !== stageId),
    });
  };

  const handleStageName = (index: number, value: string) => {
    const updated = (formData.stages || []).map((s, i) => (i === index ? { ...s, name: value } : s));
    setFormData({ ...formData, stages: updated });
  };

  const handleStageColor = (index: number, value: string) => {
    const updated = (formData.stages || []).map((s, i) => (i === index ? { ...s, color: value } : s));
    setFormData({ ...formData, stages: updated });
  };

  // ── Days ──────────────────────────────────────────────────────
  const handleAddDay = () => {
    setFormData({
      ...formData,
      days: [...(formData.days || []), { id: `day-${Date.now()}`, label: '', date: '', sets: [] }],
    });
  };

  const handleRemoveDay = (dayId: string) => {
    setFormData({
      ...formData,
      days: formData.days?.filter((d) => d.id !== dayId),
    });
  };

  const handleDayLabel = (dayId: string, value: string) => {
    const updated = (formData.days || []).map((d) => (d.id === dayId ? { ...d, label: value } : d));
    setFormData({ ...formData, days: updated });
  };

  const handleDayDate = (dayId: string, value: string) => {
    const updated = (formData.days || []).map((d) => (d.id === dayId ? { ...d, date: value } : d));
    setFormData({ ...formData, days: updated });
  };

  // ── Sets (nested under each day) ──────────────────────────────
  const handleAddSet = (dayId: string) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId
        ? {
            ...d,
            sets: [
              ...(d.sets || []),
              {
                id: `set-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                artist: '',
                stageId: formData.stages?.[0]?.id || '',
                startTime: '',
                endTime: '',
                artists: [],
              },
            ],
          }
        : d,
    );
    setFormData({ ...formData, days: updated });
  };

  const handleRemoveSet = (dayId: string, setId: string) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId ? { ...d, sets: (d.sets || []).filter((s) => s.id !== setId) } : d,
    );
    setFormData({ ...formData, days: updated });
  };

  const handleSetField = (dayId: string, setId: string, field: string, value: string | null) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId
        ? {
            ...d,
            sets: (d.sets || []).map((s) => (s.id === setId ? { ...s, [field]: value } : s)),
          }
        : d,
    );
    setFormData({ ...formData, days: updated });
  };

  return (
    <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <input
          type="text"
          placeholder="Festival Name"
          aria-label="Festival name"
          value={formData.name || ''}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <input
          type="text"
          placeholder="Location"
          aria-label="Location"
          value={formData.location || ''}
          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        <label className="flex flex-col gap-1 text-xs text-text-muted md:col-span-2">
          Time zone
          <select
            aria-label="Festival time zone"
            value={formData.timeZone || ''}
            onChange={(e) => setFormData({ ...formData, timeZone: e.target.value || null })}
            className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          >
            {/* Empty = use each attendee's device zone (the prior behavior). */}
            <option value="">Device-local (no festival zone)</option>
            {/* Merge in the festival's current value so a custom zone isn't lost. */}
            {Array.from(new Set([...COMMON_TIME_ZONES, ...(formData.timeZone ? [formData.timeZone] : [])])).map(
              (tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ),
            )}
          </select>
        </label>
      </div>

      {/* Stages */}
      <div className="border-t border-glass-border pt-4">
        <h2 className="type-label text-text-primary mb-3">Stages</h2>
        <div className="space-y-2">
          {(formData.stages || []).map((stage, i) => (
            <div key={stage.id} className="flex gap-2 items-end">
              <input
                type="text"
                placeholder="Stage name"
                aria-label="Stage name"
                value={stage.name}
                onChange={(e) => handleStageName(i, e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
              />
              <input
                type="color"
                value={stage.color}
                onChange={(e) => handleStageColor(i, e.target.value)}
                className="w-12 h-10 rounded-lg cursor-pointer"
              />
              <button
                onClick={() => handleRemoveStage(stage.id)}
                className="px-2 py-2 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={handleAddStage}
          className="mt-3 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
        >
          + Add Stage
        </button>
      </div>

      {/* Days */}
      <div className="border-t border-glass-border pt-4">
        <h2 className="type-label text-text-primary mb-3">Days &amp; Artists</h2>
        <div className="space-y-3">
          {(formData.days || []).map((day) => (
            <DayEditor
              key={day.id}
              day={day}
              stages={formData.stages || []}
              isExpanded={expandedDays.has(day.id)}
              onToggleExpand={() => toggleDayExpanded(day.id)}
              onLabelChange={(v) => handleDayLabel(day.id, v)}
              onDateChange={(v) => handleDayDate(day.id, v)}
              onRemoveDay={() => handleRemoveDay(day.id)}
              onAddSet={() => handleAddSet(day.id)}
              onRemoveSet={(setId) => handleRemoveSet(day.id, setId)}
              onSetField={(setId, field, value) => handleSetField(day.id, setId, field, value)}
            />
          ))}
        </div>
        <button
          onClick={handleAddDay}
          className="mt-3 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
        >
          + Add Day
        </button>
      </div>

      <div className="flex gap-2 justify-end border-t border-glass-border pt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium"
        >
          {editingId ? 'Update' : 'Create'} Festival
        </button>
      </div>
    </div>
  );
}

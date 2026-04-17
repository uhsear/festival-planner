import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import LineupImport from './LineupImport';
import { cn } from '../../lib/utils';

interface Festival {
  id: string;
  name: string;
  location: string;
  stageCount?: number;  // from list endpoint
  dayCount?: number;    // from list endpoint
  stages?: Array<{ id: string; name: string; color: string }>;  // from detail endpoint
  days?: Array<{ id: string; label: string; date: string; sets: any[] }>;  // from detail
}

type Tab = 'list' | 'create' | 'import';

/**
 * Festival management: CRUD, CSV import/export, lineup management
 */
export default function AdminFestivals() {
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Festival>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    loadFestivals();
  }, []);

  const loadFestivals = async () => {
    try {
      setLoading(true);
      const result = await api.get<Festival[]>('/admin/festivals');
      setFestivals(Array.isArray(result) ? result : []);
    } catch (err: any) {
      toast(err.message || 'Failed to load festivals', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.location) {
      toast('Name and location are required', 'error');
      return;
    }

    try {
      if (editingId) {
        await api.put<void>(`/admin/festivals/${editingId}`, formData);
        toast('Festival updated', 'success');
      } else {
        await api.post<void>('/admin/festivals', formData);
        toast('Festival created', 'success');
      }
      setEditingId(null);
      setFormData({});
      setTab('list');
      await loadFestivals();
    } catch (err: any) {
      toast(err.message || 'Failed to save festival', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this festival?')) return;

    try {
      await api.delete<void>(`/admin/festivals/${id}`);
      toast('Festival deleted', 'success');
      await loadFestivals();
    } catch (err: any) {
      toast(err.message || 'Failed to delete festival', 'error');
    }
  };

  const handleEdit = async (festival: Festival) => {
    setEditingId(festival.id);
    setTab('create');
    // List endpoint returns only summary (stageCount, dayCount). Fetch full
    // festival to get nested stages[] and days[] for the edit form.
    try {
      const full = await api.get<Festival>(`/festivals/${festival.id}`);
      const days = full.days || [];
      setFormData({
        ...full,
        stages: full.stages || [],
        days,
      });
      // Auto-expand all days so artists are visible immediately
      setExpandedDays(new Set(days.map((d) => d.id)));
    } catch (err: any) {
      toast(err.message || 'Failed to load festival details', 'error');
      setFormData(festival);
    }
  };

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

  // Sets (artists) helpers — nested under each day
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
      d.id === dayId ? { ...d, sets: (d.sets || []).filter((s: any) => s.id !== setId) } : d,
    );
    setFormData({ ...formData, days: updated });
  };

  const handleSetField = (dayId: string, setId: string, field: string, value: any) => {
    const updated = (formData.days || []).map((d) =>
      d.id === dayId
        ? {
            ...d,
            sets: (d.sets || []).map((s: any) =>
              s.id === setId ? { ...s, [field]: value } : s,
            ),
          }
        : d,
    );
    setFormData({ ...formData, days: updated });
  };

  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const toggleDayExpanded = (dayId: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayId)) next.delete(dayId);
      else next.add(dayId);
      return next;
    });
  };

  const filteredFestivals = festivals.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.location.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading && tab === 'list') {
    return <div className="text-center py-12 text-text-muted">Loading festivals...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-glass-border">
        {['list', 'create', 'import'].map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t as Tab);
              if (t === 'create') {
                setEditingId(null);
                setFormData({});
              }
            }}
            className={cn(
              'px-4 py-2 font-medium text-sm transition-colors border-b-2',
              tab === t
                ? 'border-accent-aqua text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {t === 'list' ? 'Festivals' : t === 'create' ? 'Create/Edit' : 'Import Lineup'}
          </button>
        ))}
      </div>

      {/* Festivals List */}
      {tab === 'list' && (
        <div>
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search festivals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
            />
          </div>

          {filteredFestivals.length === 0 ? (
            <p className="text-text-muted text-center py-8">No festivals found</p>
          ) : (
            <div className="space-y-3">
              {filteredFestivals.map((festival) => (
                <div
                  key={festival.id}
                  className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 flex items-center justify-between hover:bg-bg-card/80 transition-colors"
                >
                  <div className="flex-1">
                    <h3 className="font-semibold text-text-primary">{festival.name}</h3>
                    <p className="text-sm text-text-muted">
                      {festival.location} · {festival.stageCount ?? festival.stages?.length ?? 0} stages · {festival.dayCount ?? festival.days?.length ?? 0} days
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(festival)}
                      className="px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(festival.id)}
                      className="px-3 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Form */}
      {tab === 'create' && (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Festival Name"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
            />
            <input
              type="text"
              placeholder="Location"
              value={formData.location || ''}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
            />
          </div>

          {/* Stages */}
          <div className="border-t border-glass-border pt-4">
            <h3 className="font-semibold text-text-primary mb-3">Stages</h3>
            <div className="space-y-2">
              {(formData.stages || []).map((stage, i) => (
                <div key={stage.id} className="flex gap-2 items-end">
                  <input
                    type="text"
                    placeholder="Stage name"
                    value={stage.name}
                    onChange={(e) => {
                      const updated = [...(formData.stages || [])];
                      updated[i].name = e.target.value;
                      setFormData({ ...formData, stages: updated });
                    }}
                    className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
                  />
                  <input
                    type="color"
                    value={stage.color}
                    onChange={(e) => {
                      const updated = [...(formData.stages || [])];
                      updated[i].color = e.target.value;
                      setFormData({ ...formData, stages: updated });
                    }}
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
            <h3 className="font-semibold text-text-primary mb-3">Days &amp; Artists</h3>
            <div className="space-y-3">
              {(formData.days || []).map((day, i) => {
                const isExpanded = expandedDays.has(day.id);
                const setCount = (day.sets || []).length;
                return (
                  <div key={day.id} className="rounded-lg bg-bg-primary/40 border border-glass-border">
                    {/* Day header row */}
                    <div className="flex gap-2 items-center p-3">
                      <button
                        type="button"
                        onClick={() => toggleDayExpanded(day.id)}
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
                        onChange={(e) => {
                          const updated = [...(formData.days || [])];
                          updated[i].label = e.target.value;
                          setFormData({ ...formData, days: updated });
                        }}
                        className="flex-1 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
                      />
                      <input
                        type="date"
                        value={day.date}
                        onChange={(e) => {
                          const updated = [...(formData.days || [])];
                          updated[i].date = e.target.value;
                          setFormData({ ...formData, days: updated });
                        }}
                        className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
                      />
                      <span className="text-xs text-text-muted whitespace-nowrap">
                        {setCount} {setCount === 1 ? 'artist' : 'artists'}
                      </span>
                      <button
                        onClick={() => handleRemoveDay(day.id)}
                        className="px-2 py-2 rounded-lg bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-sm"
                      >
                        Remove
                      </button>
                    </div>

                    {/* Expanded: artists/sets list */}
                    {isExpanded && (
                      <div className="border-t border-glass-border p-3 space-y-2">
                        {(day.sets || []).length === 0 ? (
                          <p className="text-xs text-text-muted italic">No artists yet. Click "Add Artist" to add one, or use the Import Lineup tab.</p>
                        ) : (
                          <div className="space-y-2">
                            <div className="grid grid-cols-[1fr_140px_90px_90px_auto] gap-2 text-xs text-text-muted px-1">
                              <div>Artist</div>
                              <div>Stage</div>
                              <div>Start</div>
                              <div>End</div>
                              <div></div>
                            </div>
                            {(day.sets || []).map((s: any) => (
                              <div key={s.id} className="grid grid-cols-[1fr_140px_90px_90px_auto] gap-2">
                                <input
                                  type="text"
                                  placeholder="Artist name"
                                  value={s.artist || ''}
                                  onChange={(e) => handleSetField(day.id, s.id, 'artist', e.target.value)}
                                  className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent-aqua"
                                />
                                <select
                                  value={s.stageId || ''}
                                  onChange={(e) => handleSetField(day.id, s.id, 'stageId', e.target.value)}
                                  className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
                                >
                                  <option value="">— Stage —</option>
                                  {(formData.stages || []).map((st) => (
                                    <option key={st.id} value={st.id}>{st.name || st.id}</option>
                                  ))}
                                </select>
                                <input
                                  type="time"
                                  value={s.startTime && s.startTime !== 'TBA' ? s.startTime : ''}
                                  onChange={(e) => handleSetField(day.id, s.id, 'startTime', e.target.value || 'TBA')}
                                  className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
                                />
                                <input
                                  type="time"
                                  value={s.endTime && s.endTime !== 'TBA' ? s.endTime : ''}
                                  onChange={(e) => handleSetField(day.id, s.id, 'endTime', e.target.value || null)}
                                  className="px-2 py-1.5 rounded bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-aqua"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSet(day.id, s.id)}
                                  className="px-2 rounded bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                                  aria-label={`Remove ${s.artist || 'artist'}`}
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => handleAddSet(day.id)}
                          className="mt-2 px-3 py-1.5 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium"
                        >
                          + Add Artist
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
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
              onClick={() => {
                setTab('list');
                setEditingId(null);
                setFormData({});
              }}
              className="px-4 py-2 rounded-lg bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium"
            >
              {editingId ? 'Update' : 'Create'} Festival
            </button>
          </div>
        </div>
      )}

      {/* Import */}
      {tab === 'import' && editingId && <LineupImport festivalId={editingId} onSuccess={() => { loadFestivals(); setTab('list'); }} />}
      {tab === 'import' && !editingId && <p className="text-center text-[var(--text-muted)] py-8">Select a festival to import a lineup.</p>}
    </div>
  );
}

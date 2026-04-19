import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import LineupImport from './LineupImport';
import FestivalEditForm, { Festival as FormFestival } from './FestivalEditForm';
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
 * Festival management: CRUD, CSV import/export, lineup management.
 *
 * Hosts the list/table view and "Create New" entry. The edit form itself
 * (stages, days, per-set artist rows) is split into FestivalEditForm →
 * DayEditor → SetEditor.
 */
export default function AdminFestivals() {
  const [festivals, setFestivals] = useState<Festival[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<FormFestival>>({});
  const [initialExpandedDays, setInitialExpandedDays] = useState<Set<string>>(new Set());
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
      setInitialExpandedDays(new Set());
      setTab('list');
      await loadFestivals();
    } catch (err: any) {
      toast(err.message || 'Failed to save festival', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    const festival = festivals.find((f) => f.id === id);
    const name = festival?.name || 'this festival';
    if (
      !confirm(
        `Delete ${name}?\n\nThis soft-deletes the festival and hides it from users. Users with picks for this festival will lose access.`,
      )
    ) {
      return;
    }

    try {
      await api.delete<void>(`/admin/festivals/${id}`);
      toast(`Deleted ${name}`, 'success');
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
      setInitialExpandedDays(new Set(days.map((d) => d.id)));
    } catch (err: any) {
      toast(err.message || 'Failed to load festival details', 'error');
      setFormData(festival as Partial<FormFestival>);
    }
  };

  const handleCancel = () => {
    setTab('list');
    setEditingId(null);
    setFormData({});
    setInitialExpandedDays(new Set());
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
        {(['list', 'create', 'import'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === 'create') {
                setEditingId(null);
                setFormData({});
                setInitialExpandedDays(new Set());
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
          <div className="mb-4 flex gap-2">
            <input
              type="text"
              placeholder="Search festivals..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
            />
            <button
              onClick={() => {
                setEditingId(null);
                setFormData({});
                setInitialExpandedDays(new Set());
                setTab('create');
              }}
              className="px-4 py-2 rounded-lg bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium whitespace-nowrap"
            >
              + Create New
            </button>
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
                    <h2 className="text-base font-semibold text-text-primary">{festival.name}</h2>
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
        <FestivalEditForm
          formData={formData}
          setFormData={setFormData}
          editingId={editingId}
          initialExpandedDays={initialExpandedDays}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}

      {/* Import */}
      {tab === 'import' && editingId && (
        <LineupImport
          festivalId={editingId}
          onSuccess={() => {
            loadFestivals();
            setTab('list');
          }}
        />
      )}
      {tab === 'import' && !editingId && (
        <p className="text-center text-[var(--text-muted)] py-8">
          Select a festival to import a lineup.
        </p>
      )}
    </div>
  );
}

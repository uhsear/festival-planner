import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

interface Crew {
  id: string;
  name: string;
  festivalId: string;
  createdBy: string;
  memberCount: number;
  createdAt: string;
}

/**
 * Crew management: list, search, delete, view members
 */
export default function AdminCrews() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadCrews();
  }, []);

  const loadCrews = async () => {
    try {
      setLoading(true);
      const result = await api.get<Crew[]>('/admin/crews');
      setCrews(Array.isArray(result) ? result : []);
    } catch (err: any) {
      toast(err.message || 'Failed to load crews', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (crewId: string) => {
    if (!confirm('Are you sure you want to delete this crew?')) return;

    try {
      await api.delete<void>(`/admin/crews/${crewId}`);
      setCrews(crews.filter((c) => c.id !== crewId));
      toast('Crew deleted', 'success');
    } catch (err: any) {
      toast(err.message || 'Failed to delete crew', 'error');
    }
  };

  const filteredCrews = crews.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.createdBy.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading crews...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Crews ({filteredCrews.length})</h2>
      </div>

      <input
        type="text"
        placeholder="Search by crew name or creator..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
      />

      {filteredCrews.length === 0 ? (
        <p className="text-text-muted text-center py-8">No crews found</p>
      ) : (
        <div className="space-y-3">
          {filteredCrews.map((crew) => (
            <div
              key={crew.id}
              className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-text-primary">{crew.name}</h3>
                  <p className="text-xs text-text-muted mt-1">
                    {crew.memberCount} member{crew.memberCount !== 1 ? 's' : ''} • Created by {crew.createdBy} •{' '}
                    {new Date(crew.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setExpandedId(expandedId === crew.id ? null : crew.id)}
                    className="text-xs px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                  >
                    {expandedId === crew.id ? 'Hide' : 'View'}
                  </button>
                  <button
                    onClick={() => handleDelete(crew.id)}
                    className="text-xs px-3 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {expandedId === crew.id && (
                <div className="mt-3 pt-3 border-t border-glass-border">
                  <p className="text-xs text-text-muted mb-2">Festival ID: {crew.festivalId}</p>
                  <p className="text-xs text-text-muted">Crew ID: {crew.id}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

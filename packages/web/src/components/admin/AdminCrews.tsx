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

interface CrewMember {
  userId: string;
  username?: string;
  role?: string;
  avatar?: string;
  joinedAt?: string;
}

/**
 * Crew management: list, search, delete, view members
 */
export default function AdminCrews() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersByCrew, setMembersByCrew] = useState<Record<string, CrewMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({});
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

  const loadCrewMembers = async (crewId: string) => {
    // Already cached — re-expand is instant.
    if (membersByCrew[crewId]) return;
    setMembersLoading((prev) => ({ ...prev, [crewId]: true }));
    try {
      const result = await api.get<CrewMember[]>(`/admin/crews/${crewId}/members`);
      setMembersByCrew((prev) => ({ ...prev, [crewId]: Array.isArray(result) ? result : [] }));
    } catch (err: any) {
      toast(err.message || 'Failed to load members', 'error');
    } finally {
      setMembersLoading((prev) => ({ ...prev, [crewId]: false }));
    }
  };

  const handleToggleExpand = (crewId: string) => {
    if (expandedId === crewId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(crewId);
    // Fire-and-forget; state drives UI.
    void loadCrewMembers(crewId);
  };

  const handleDelete = async (crewId: string) => {
    const target = crews.find((c) => c.id === crewId);
    const name = target?.name || 'this crew';
    if (
      !confirm(
        `Delete ${name}?\n\nThis removes the crew and all ${target?.memberCount ?? ''} member link${target?.memberCount === 1 ? '' : 's'}. Members will lose access to shared picks.`,
      )
    ) {
      return;
    }

    try {
      await api.delete<void>(`/admin/crews/${crewId}`);
      setCrews(crews.filter((c) => c.id !== crewId));
      toast(`Deleted ${name}`, 'success');
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
          {filteredCrews.map((crew) => {
            const isExpanded = expandedId === crew.id;
            const members = membersByCrew[crew.id];
            const isLoadingMembers = !!membersLoading[crew.id];
            return (
              <div
                key={crew.id}
                className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h2 className="text-base font-semibold text-text-primary">{crew.name}</h2>
                    <p className="text-xs text-text-muted mt-1">
                      {crew.memberCount} member{crew.memberCount !== 1 ? 's' : ''} • Created by {crew.createdBy} •{' '}
                      {new Date(crew.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleExpand(crew.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                    <button
                      onClick={() => handleDelete(crew.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-glass-border space-y-3">
                    <div>
                      <p className="text-xs text-text-muted">Festival ID: {crew.festivalId}</p>
                      <p className="text-xs text-text-muted">Crew ID: {crew.id}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-text-primary mb-2">Members</h4>
                      {isLoadingMembers && !members ? (
                        <p className="text-xs text-text-muted italic">Loading members…</p>
                      ) : !members || members.length === 0 ? (
                        <p className="text-xs text-text-muted italic">No members.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {members.map((m) => (
                            <li
                              key={m.userId}
                              className="flex items-center gap-2 text-xs text-text-secondary"
                            >
                              {m.avatar ? (
                                <img
                                  src={m.avatar}
                                  alt=""
                                  width={24}
                                  height={24}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-6 h-6 rounded-full object-cover bg-bg-primary"
                                />
                              ) : (
                                <div
                                  className="w-6 h-6 rounded-full bg-bg-primary border border-glass-border flex items-center justify-center text-[10px] text-text-muted"
                                  aria-hidden="true"
                                >
                                  {(m.username || m.userId || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="text-text-primary">{m.username || m.userId}</span>
                              <span className="text-text-muted">· {m.role || 'member'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

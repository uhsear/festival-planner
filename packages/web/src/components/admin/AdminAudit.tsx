import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

interface AuditEntry {
  id: string;
  action: string;
  actorUsername?: string;
  details?: any;
  createdAt: string;
}

/**
 * Audit log viewer with filtering and pagination
 */
export default function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [hasMore, setHasMore] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAudit();
  }, [page, actionFilter, userFilter, dateFrom, dateTo]);

  const loadAudit = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '50');
      if (actionFilter) params.set('action', actionFilter);
      if (userFilter) params.set('user', userFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      const result = await api.get<any>(`/admin/audit?${params.toString()}`);
      setEntries(Array.isArray(result.entries) ? result.entries : []);
      setHasMore(typeof result.hasMore === 'boolean' ? result.hasMore : undefined);
    } catch (err: any) {
      toast(err.message || 'Failed to load audit log', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading audit log...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
        <h3 className="font-semibold text-text-primary mb-3">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Action type..."
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="text"
            placeholder="Username..."
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
        </div>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <p className="text-text-muted text-center py-8">No audit entries found</p>
      ) : (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
          <div className="divide-y divide-glass-border">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="px-6 py-4 hover:bg-bg-primary/20 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-text-primary">{entry.action.replace(/[_:]/g, ' ')}</div>
                    <div className="text-xs text-text-muted mt-1">
                      {entry.actorUsername || 'system'} • {formatTimeAgo(entry.createdAt)}
                    </div>
                  </div>
                  <div className="text-xl text-text-muted ml-4">{expandedId === entry.id ? '−' : '+'}</div>
                </div>

                {expandedId === entry.id && entry.details && (
                  <div className="mt-4 pt-4 border-t border-glass-border">
                    <pre className="bg-bg-primary/30 p-3 rounded-lg text-xs text-text-secondary overflow-x-auto">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {entries.length > 0 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-muted text-sm">Page {page + 1}</span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={typeof hasMore === 'boolean' ? !hasMore : entries.length < 50}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

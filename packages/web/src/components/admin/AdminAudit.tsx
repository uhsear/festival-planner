import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import { SearchX } from 'lucide-react';

interface AuditEntry {
  id: string;
  action: string;
  actorUsername?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Audit log viewer with filtering and pagination
 */
export default function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Stack of previous cursors for back-navigation; null = first page
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadAudit();
  }, [currentCursor, actionFilter, userFilter, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps -- loadAudit reads filter state directly

  const loadAudit = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (currentCursor) params.set('cursor', currentCursor);
      if (actionFilter) params.set('action', actionFilter);
      if (userFilter) params.set('user', userFilter);
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);

      // Fetch raw so we can read `meta` for pagination — the api wrapper
      // strips everything but `data`.
      const result = await api.get<AuditEntry[]>(`/admin/audit?${params.toString()}`);
      const list = Array.isArray(result) ? result : [];
      setEntries(list);
      // Server returns nextCursor via meta; infer hasMore from page size
      // since the api wrapper strips meta.
      setNextCursor(list.length >= 50 ? (list[list.length - 1]?.id ?? null) : null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't load the audit log. Try again.", 'error');
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
  };

  const goPrev = () => {
    if (cursorStack.length === 0) return;
    const prev = [...cursorStack];
    const lastCursor = prev.pop()!;
    setCursorStack(prev);
    setCurrentCursor(lastCursor);
  };

  const resetPagination = () => {
    setCursorStack([]);
    setCurrentCursor(null);
  };

  const formatTimeAgo = (dateStr: string): string => {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // Only show the full-page spinner on first load. Subsequent filter/page
  // changes keep the table visible and dim it via aria-busy so the view
  // doesn't flash to "Loading..." every keystroke.
  if (loading && !hasLoadedOnce) {
    return <div className="text-center py-12 text-text-muted">Loading audit log…</div>;
  }

  return (
    <div className="space-y-6" aria-busy={loading}>
      {/* Filters */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
        <h2 className="type-label text-text-primary mb-3">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Action type…"
            aria-label="Filter by action type"
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="text"
            placeholder="Username…"
            aria-label="Filter by username"
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="date"
            aria-label="Filter: date from"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="date"
            aria-label="Filter: date to"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
        </div>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <EmptyState
          icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
          title="No audit entries found"
          description="Try adjusting your filters or date range."
        />
      ) : (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
          <div className="divide-y divide-glass-border">
            {entries.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                aria-expanded={expandedId === entry.id}
                className="px-6 py-4 hover:bg-bg-primary/20 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId(expandedId === entry.id ? null : entry.id);
                  }
                }}
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
            onClick={goPrev}
            disabled={cursorStack.length === 0}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-muted text-sm">Page {cursorStack.length + 1}</span>
          <button
            onClick={goNext}
            disabled={!nextCursor}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

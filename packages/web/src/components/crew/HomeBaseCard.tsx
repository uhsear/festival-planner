import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import { MapPin, X } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  currentLocation: string | null;
  currentTime: string | null;
  isOwner: boolean;
  /** Called after a successful save so the parent can refresh active crew
   *  state — we can't rely on React Query invalidation alone because
   *  `activeCrew` lives in Zustand (crewStore), not the query cache. */
  onSaved?: () => void | Promise<void>;
}

// Server: PUT /crews/:crewId/home-base { location, time }. Only the owner is
// allowed to change it (crew-features.js:23). We render a compact card that
// shows the pin inline; owners get inline editing, non-owners see read-only.
export default function HomeBaseCard({ crewId, currentLocation, currentTime, isOwner, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [loc, setLoc] = useState(currentLocation || '');
  const [time, setTime] = useState(currentTime || '');

  // Keep form in sync if the parent-supplied values change (e.g. after another
  // user/tab saves a home base via socket).
  useEffect(() => { setLoc(currentLocation || ''); setTime(currentTime || ''); }, [currentLocation, currentTime]);

  const save = useMutation({
    mutationFn: (payload: { location: string; time: string | null }) =>
      api.put(`/crews/${crewId}/home-base`, payload),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['crews'] });
      qc.invalidateQueries({ queryKey: ['crew', crewId] });
      toast('Home base updated', 'success');
      setEditing(false);
      try { await onSaved?.(); } catch {/* ignore */}
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to update', 'error'),
  });

  const hasHomeBase = !!currentLocation;

  if (!hasHomeBase && !isOwner) {
    // Hide the card entirely if there's nothing to show and the user can't edit.
    return null;
  }

  if (editing) {
    return (
      <div className="p-3 rounded-lg bg-bg-card border border-accent-aqua/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <MapPin className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
            Set Home Base
          </h3>
          <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={() => setEditing(false)} />
        </div>
        <input className={`${inputBase} min-h-11`} placeholder="Where should the crew meet?"
          aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)} maxLength={200} />
        <input type="time" className={`${inputBase} min-h-11`} placeholder="Time (optional)"
          aria-label="Meet at time" value={time} onChange={(e) => setTime(e.target.value)} />
        <Button variant="primary" isLoading={save.isPending} disabled={!loc.trim()}
          onClick={() => save.mutate({ location: loc.trim(), time: time || null })} className="w-full min-h-11">
          Save
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (isOwner ? setEditing(true) : undefined)}
      disabled={!isOwner}
      className={`w-full py-1.5 px-2 min-h-11 rounded-lg bg-bg-card border text-left transition-colors ${
        hasHomeBase ? 'border-accent-aqua/40' : 'border-dashed border-border hover:border-border-light'
      } ${isOwner ? 'cursor-pointer' : 'cursor-default'}`}>
      <div className="flex items-center gap-2">
        <MapPin className={`w-4 h-4 flex-shrink-0 ${hasHomeBase ? 'text-accent-aqua' : 'text-text-muted'}`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {hasHomeBase ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-primary truncate">{currentLocation}</span>
              {currentTime && <span className="text-xs text-accent-aqua flex-shrink-0">⏰ {currentTime}</span>}
            </div>
          ) : (
            <span className="text-xs text-text-secondary">Tap to set a meeting point</span>
          )}
        </div>
      </div>
    </button>
  );
}

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import { MapPin, Plus, Trash2, X, Navigation, Pencil } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';

// Server enum (lib/constants.js MEETING_POINT_TYPES) + user-facing metadata.
const TYPES = [
  { key: 'pre-show', emoji: '🎪', label: 'Pre-show' },
  { key: 'during', emoji: '📍', label: 'During' },
  { key: 'post-show', emoji: '🏁', label: 'Post-show' },
  { key: 'post-event', emoji: '🌙', label: 'After' },
  { key: 'emergency', emoji: '🚨', label: 'Emergency' },
  { key: 'general', emoji: '🔖', label: 'General' },
] as const;
type TypeKey = (typeof TYPES)[number]['key'];

// Server shape (snake_case from Postgres); crew_features.js returns {meetingPoints} but unwrapping below handles both.
interface MeetingPoint {
  id: string;
  crew_id: string;
  created_by: string;
  label: string;
  location: string;
  type: TypeKey;
  meet_at: string | null;
  stage_reference: string | null;
  active: boolean;
  created_at: string;
}

interface MeetingPointPayload {
  label: string;
  location: string;
  type: TypeKey;
  meetAt?: string | null;
  stageReference?: string | null;
}

interface Props {
  crewId: string;
  currentUserId: string;
}

export default function MeetingPointsTab({ crewId, currentUserId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [location, setLocation] = useState('');
  const [stageRef, setStageRef] = useState('');
  const [type, setType] = useState<TypeKey>('during');
  const [meetAt, setMeetAt] = useState('');

  const {
    data: points = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<MeetingPoint[]>({
    queryKey: ['meeting-points', crewId],
    queryFn: async () => {
      const res = await api.get<MeetingPoint[] | { meetingPoints: MeetingPoint[] }>(`/crews/${crewId}/meeting-points`);
      return Array.isArray(res) ? res : res?.meetingPoints || [];
    },
    enabled: !!crewId,
  });

  const createPoint = useMutation({
    mutationFn: (payload: MeetingPointPayload) => api.post(`/crews/${crewId}/meeting-points`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      toast('Meeting point added', 'success');
      reset();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to add', 'error'),
  });

  const updatePoint = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MeetingPointPayload }) =>
      api.put(`/crews/${crewId}/meeting-points/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      toast('Meeting point updated', 'success');
      reset();
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to update', 'error'),
  });

  const removePoint = useMutation({
    mutationFn: (id: string) => api.delete(`/crews/${crewId}/meeting-points/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['meeting-points', crewId] });
      toast('Removed', 'success');
    },
    onError: () => toast('Failed to remove', 'error'),
  });

  function reset() {
    setLabel('');
    setLocation('');
    setStageRef('');
    setType('during');
    setMeetAt('');
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(p: MeetingPoint) {
    setEditingId(p.id);
    setLabel(p.label);
    setLocation(p.location);
    setStageRef(p.stage_reference || '');
    setType(p.type);
    // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
    setMeetAt(p.meet_at ? toLocalInput(p.meet_at) : '');
    setShowForm(true);
  }

  function openDirections(loc: string) {
    window.open(`https://maps.google.com/?q=${encodeURIComponent(loc)}`, '_blank', 'noopener,noreferrer');
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !location.trim()) return;
    const payload: MeetingPointPayload = {
      label: label.trim(),
      location: location.trim(),
      type,
      meetAt: meetAt ? new Date(meetAt).toISOString() : null,
      stageReference: stageRef.trim() || null,
    };
    if (editingId) {
      updatePoint.mutate({ id: editingId, payload });
    } else {
      createPoint.mutate(payload);
    }
  }

  const submitting = createPoint.isPending || updatePoint.isPending;

  if (isLoading) {
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="card" />
        <Skeleton variant="card" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load meeting points"
          description="Something went wrong loading meeting points."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4">
      {!showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add Meeting Point
        </Button>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">
              {editingId ? 'Edit Meeting Point' : 'New Meeting Point'}
            </h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>

          <div className="crew-type-grid grid grid-cols-3 gap-2" role="radiogroup" aria-label="Meeting point type">
            {TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={type === t.key}
                onClick={() => setType(t.key)}
                className={`px-2 py-2 rounded-lg border text-xs font-medium min-h-11 flex flex-col items-center gap-1 transition-colors ${
                  type === t.key
                    ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                    : 'bg-bg-card border-border text-text-secondary hover:border-border-light'
                }`}
              >
                <span className="text-base leading-none" aria-hidden="true">
                  {t.emoji}
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <input
            className={`${inputBase} min-h-11`}
            placeholder="Label (e.g. 'Main entrance')"
            aria-label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            required
          />
          <input
            className={`${inputBase} min-h-11`}
            placeholder="Location (e.g. 'Near the food court')"
            aria-label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={200}
            required
          />
          <input
            className={`${inputBase} min-h-11`}
            placeholder="Near stage (optional, e.g. 'Main Stage')"
            aria-label="Near stage"
            value={stageRef}
            onChange={(e) => setStageRef(e.target.value)}
            maxLength={100}
          />
          <input
            type="datetime-local"
            className={`${inputBase} min-h-11`}
            placeholder="Meet at (optional)"
            aria-label="Meet at time"
            value={meetAt}
            onChange={(e) => setMeetAt(e.target.value)}
          />

          <Button
            type="submit"
            variant="primary"
            isLoading={submitting}
            className="w-full min-h-11"
            disabled={!label.trim() || !location.trim()}
          >
            {editingId ? 'Save' : 'Add'}
          </Button>
        </form>
      )}

      {points.length === 0 ? (
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="No meeting points yet"
          description="Drop a pin so your crew knows where to meet."
        />
      ) : (
        <div className="space-y-2">
          {points.map((p) => {
            const meta = TYPES.find((t) => t.key === p.type) || TYPES[1];
            const mine = p.created_by === currentUserId;
            const isEmergency = p.type === 'emergency';
            return (
              <div
                key={p.id}
                className={`p-3 rounded-lg bg-bg-card border animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none ${isEmergency ? 'border-accent-coral border-l-4' : 'border-border'}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl leading-none" aria-hidden="true">
                    {meta.emoji}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-primary">{p.label}</span>
                      <span className="text-xs text-text-muted uppercase tracking-wide">{meta.label}</span>
                    </div>
                    <div className="text-sm text-text-secondary mt-0.5">{p.location}</div>
                    {p.stage_reference && (
                      <div className="text-xs text-accent-aqua mt-0.5">Near {p.stage_reference}</div>
                    )}
                    {p.meet_at && (
                      <div className="text-xs text-accent-aqua mt-1">
                        ⏰ {new Date(p.meet_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <IconButton
                      label={`Directions to ${p.label}`}
                      icon={<Navigation className="w-4 h-4" />}
                      onClick={() => openDirections(p.location)}
                    />
                    {mine && (
                      <>
                        <IconButton
                          label="Edit meeting point"
                          icon={<Pencil className="w-4 h-4" />}
                          onClick={() => startEdit(p)}
                        />
                        <IconButton
                          label="Remove meeting point"
                          variant="danger"
                          icon={<Trash2 className="w-4 h-4" />}
                          onClick={() => removePoint.mutate(p.id)}
                          disabled={removePoint.isPending}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ISO (UTC) → "YYYY-MM-DDTHH:mm" in local time for <input type="datetime-local">.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

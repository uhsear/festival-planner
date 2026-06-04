import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import { Images, X, ExternalLink } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  currentUrl: string | null;
  /** Called after a successful save so the parent can refresh active crew
   *  state — `activeCrew` lives in Zustand (crewStore), not the query cache. */
  onSaved?: () => void | Promise<void>;
}

// M6 Crew Photo Wall — Phase 1, link-out only. Festie does not host photos yet
// (the R2 upload pipeline is deferred). This card stores a single shared-album
// URL (e.g. Google Photos / Apple shared album) that any crew member can paste;
// everyone can open it. Server: member-gated PUT /crews/:crewId/photo-album.
export default function CrewPhotosCard({ crewId, currentUrl, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(currentUrl || '');

  // Keep the form in sync if the parent-supplied value changes (e.g. another
  // member/tab saves an album link via socket).
  useEffect(() => {
    setUrl(currentUrl || '');
  }, [currentUrl]);

  const save = useMutation({
    mutationFn: (payload: { photoAlbumUrl: string | null }) => api.put(`/crews/${crewId}/photo-album`, payload),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['crews'] });
      qc.invalidateQueries({ queryKey: ['crew', crewId] });
      toast('Crew photos updated', 'success');
      setEditing(false);
      try {
        await onSaved?.();
      } catch {
        /* ignore */
      }
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'Failed to update', 'error'),
  });

  const trimmed = url.trim();
  // Only accept https links (matches the backend schema) to keep the Open
  // button safe and avoid javascript:/data: schemes.
  const isValid = trimmed === '' || trimmed.startsWith('https://');

  if (editing) {
    return (
      <div className="p-3 rounded-lg bg-bg-card border border-accent-aqua/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <Images className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
            Crew photos
          </h3>
          <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={() => setEditing(false)} />
        </div>
        <p className="text-xs text-text-secondary">
          Paste a shared album link (Google Photos, Apple shared album, etc.) so the crew can view and add photos.
        </p>
        <input
          className={`${inputBase} min-h-11`}
          type="url"
          inputMode="url"
          placeholder="https://photos.app.goo.gl/…"
          aria-label="Shared album URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          maxLength={2048}
        />
        {!isValid && <p className="text-xs text-accent-coral">Link must start with https://</p>}
        <div className="flex gap-2">
          <Button
            variant="primary"
            isLoading={save.isPending}
            disabled={!isValid}
            onClick={() => save.mutate({ photoAlbumUrl: trimmed || null })}
            className="flex-1 min-h-11"
          >
            Save
          </Button>
          {currentUrl && (
            <Button
              variant="ghost"
              isLoading={save.isPending}
              onClick={() => {
                setUrl('');
                save.mutate({ photoAlbumUrl: null });
              }}
              className="min-h-11"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!currentUrl) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="w-full py-1.5 px-2 min-h-11 rounded-lg bg-bg-card border border-dashed border-border hover:border-border-light text-left transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Images className="w-4 h-4 flex-shrink-0 text-text-muted" aria-hidden="true" />
          <span className="text-xs text-text-secondary">Add a shared photo album</span>
        </div>
      </button>
    );
  }

  return (
    <div className="w-full py-1.5 px-2 rounded-lg bg-bg-card border border-accent-aqua/40">
      <div className="flex items-center gap-2">
        <Images className="w-4 h-4 flex-shrink-0 text-accent-aqua" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-xs font-semibold text-text-primary truncate">Crew photos</span>
        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs font-semibold text-accent-aqua hover:underline min-h-11 px-1"
        >
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          Open
        </a>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-text-secondary hover:text-text-primary min-h-11 px-1"
          aria-label="Edit crew photo album link"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

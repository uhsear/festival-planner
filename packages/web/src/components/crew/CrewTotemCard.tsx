import React, { useState, useEffect } from 'react';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Flag, X } from 'lucide-react';
import { inputBase } from '../../lib/styles';

// Server caps: totem_name ≤ 40, totem_emoji ≤ 16 (see CreateCrewRequest /
// UpdateCrewRequest docs). Enforced client-side as a UX nicety; the backend Zod
// schema is the authoritative boundary.
const TOTEM_NAME_MAX = 40;
const TOTEM_EMOJI_MAX = 16;

interface Props {
  crewId: string;
  totemName: string | null;
  totemEmoji: string | null;
  isOwner: boolean;
  /** Called after a successful save so the parent can refresh active crew state. */
  onSaved?: () => void | Promise<void>;
}

/**
 * Crew totem (rally marker) card — the flag/sign the crew holds up to find each
 * other. Shows the emoji + name prominently so it reads at a glance; owners get
 * inline editing (emoji is a plain text field with a helper, NOT an emoji
 * picker). Mirrors HomeBaseCard's owner-editable card pattern. Persists via the
 * shared crewStore.updateCrew (camelCase totemName/totemEmoji in; snake_case
 * back).
 */
export default function CrewTotemCard({ crewId, totemName, totemEmoji, isOwner, onSaved }: Props) {
  const updateCrew = useCrewStore((s) => s.updateCrew);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(totemName ?? '');
  const [emoji, setEmoji] = useState(totemEmoji ?? '');

  // Keep the form in sync if the parent-supplied values change (e.g. another
  // tab/user edits the totem and the crew reloads).
  useEffect(() => {
    setName(totemName ?? '');
    setEmoji(totemEmoji ?? '');
  }, [totemName, totemEmoji]);

  const hasTotem = !!(totemName || totemEmoji);

  if (!hasTotem && !isOwner) {
    // Nothing to show and the user can't edit — hide entirely.
    return null;
  }

  const save = async () => {
    setBusy(true);
    try {
      await updateCrew(crewId, {
        totemName: name.trim(),
        totemEmoji: emoji.trim(),
      });
      toast('Crew totem updated', 'success');
      setEditing(false);
      await onSaved?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update totem. Try again.", 'error');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="p-3 rounded-lg bg-bg-card border border-accent-aqua/40 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-text-primary flex items-center gap-2">
            <Flag className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
            Crew totem
          </h3>
          <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={() => setEditing(false)} />
        </div>
        <div className="space-y-1">
          <input
            className={`${inputBase} min-h-11`}
            placeholder="Giant inflatable flamingo"
            aria-label="Totem name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={TOTEM_NAME_MAX}
          />
        </div>
        <div className="space-y-1">
          <input
            className={`${inputBase} min-h-11`}
            placeholder="🦩"
            aria-label="Totem emoji"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            maxLength={TOTEM_EMOJI_MAX}
          />
          <p className="text-xs text-text-muted">
            Type an emoji (or a couple) — paste from your keyboard's emoji panel.
          </p>
        </div>
        <Button
          variant="primary"
          isLoading={busy}
          disabled={busy || (!name.trim() && !emoji.trim())}
          onClick={save}
          className="w-full min-h-11"
        >
          Save totem
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => (isOwner ? setEditing(true) : undefined)}
      disabled={!isOwner}
      aria-label={
        hasTotem ? `Crew totem: ${totemName ?? totemEmoji}${isOwner ? ', tap to edit' : ''}` : 'Set a crew totem'
      }
      data-testid="crew-totem-card"
      className={`w-full py-2 px-3 min-h-11 rounded-lg bg-bg-card border text-left transition-colors ${
        hasTotem ? 'border-accent-aqua/40' : 'border-dashed border-border hover:border-border-light'
      } ${isOwner ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-3">
        {hasTotem ? (
          <>
            <span className="text-2xl leading-none flex-shrink-0" aria-hidden="true">
              {totemEmoji || '🚩'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[.8px] text-text-muted leading-none">
                Find your crew
              </p>
              <p className="text-sm font-bold text-text-primary truncate mt-0.5">{totemName || 'Our totem'}</p>
            </div>
          </>
        ) : (
          <>
            <Flag className="w-4 h-4 flex-shrink-0 text-text-muted" aria-hidden="true" />
            <span className="text-xs text-text-secondary">Tap to set your crew totem</span>
          </>
        )}
      </div>
    </button>
  );
}

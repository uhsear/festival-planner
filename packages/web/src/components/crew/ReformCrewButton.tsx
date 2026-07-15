import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, CalendarPlus } from 'lucide-react';
import { useCrewStore } from '@festie/shared/stores';
import { useFestivalDataStore } from '@festie/shared/stores';
import type { ReformCrewResponse } from '@festie/shared/types';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';
import { useToast } from '../../lib/toastContext';

interface Props {
  /** The source crew being reformed. */
  crewId: string;
  /** The festival the source crew belongs to (excluded from the target list). */
  sourceFestivalId?: string;
  /** Crew name, for the dialog copy. */
  crewName: string;
}

/**
 * "Reform this crew for {festival}" — crews are festival-scoped, so this creates
 * a NEW crew in the chosen festival and brings the prior roster across (members
 * with a profile in the target are auto-added; the rest get the invite link).
 * Consent-safe: nobody is silently added to a festival they haven't joined.
 */
export default function ReformCrewButton({ crewId, sourceFestivalId, crewName }: Props) {
  const { toast } = useToast();
  const reformCrew = useCrewStore((s) => s.reformCrew);
  const festivals = useFestivalDataStore((s) => s.festivals);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);

  // Load the festival list lazily when the dialog opens.
  useEffect(() => {
    if (open && festivals.length === 0) loadFestivals().catch(() => {});
  }, [open, festivals.length, loadFestivals]);

  // Focus the festival select when the dialog opens (was autoFocus).
  useEffect(() => {
    if (open) selectRef.current?.focus();
  }, [open]);

  // Offer every festival except the source crew's own.
  const options = useMemo(() => festivals.filter((f) => f.id !== sourceFestivalId), [festivals, sourceFestivalId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    try {
      const res: ReformCrewResponse = await reformCrew(crewId, target);
      const added = res.reform?.autoAdded?.length ?? 0;
      const invited = res.reform?.invited?.length ?? 0;
      const fest = options.find((f) => f.id === target)?.name ?? 'the festival';
      toast(`Reformed for ${fest} — ${added} added, ${invited} to invite via the link.`, 'success');
      setOpen(false);
      setTarget('');
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't reform crew. Try again.", 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" fullWidth className="min-h-11">
          <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Reform this crew for another festival
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2
                     rounded-2xl bg-bg-card border border-border-light shadow-2xl p-5 space-y-4
                     data-[state=open]:animate-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-bold text-text-primary">Reform crew</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-text-secondary">
                Start “{crewName}” fresh for another festival. Members who’ve already joined that festival are added
                automatically; share the invite link with everyone else.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="space-y-3" {...(busy ? { 'aria-busy': true } : {})}>
            <select
              ref={selectRef}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={busy}
              aria-label="Target festival"
              className={`${inputBase} min-h-11`}
            >
              <option value="">Choose a festival…</option>
              {options.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {options.length === 0 && <p className="text-sm text-text-secondary">No other festivals available yet.</p>}
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" type="button" className="flex-1 min-h-11">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                isLoading={busy}
                disabled={!target || busy}
                className="flex-1 min-h-11"
              >
                Reform
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

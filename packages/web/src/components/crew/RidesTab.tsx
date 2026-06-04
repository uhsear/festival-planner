import React, { useEffect, useState } from 'react';
import { useCrewStore } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import IconButton from '../ui/IconButton';
import { Car, MapPin, Plus, Trash2, Users, X } from 'lucide-react';

interface Props {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew carpool / ride board (M2 logistics) — a shared "who's driving" board.
 * Offline-native: reads/writes go through the crewStore, so an offer posted with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as packing). Each row is a ride OFFER — driver, seats, where
 * they're leaving from and when.
 */
export default function RidesTab({ crewId, currentUserId, isOwner }: Props) {
  const { toast } = useToast();
  const { warning } = useHaptics();

  const offers = useCrewStore((s) => s.rideOffers);
  const loadRides = useCrewStore((s) => s.loadRides);
  const createRideOffer = useCrewStore((s) => s.createRideOffer);
  const deleteRideOffer = useCrewStore((s) => s.deleteRideOffer);

  const [showForm, setShowForm] = useState(false);
  const [driver, setDriver] = useState('');
  const [seats, setSeats] = useState('');
  const [departFrom, setDepartFrom] = useState('');
  const [departAt, setDepartAt] = useState('');
  const [note, setNote] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (crewId) loadRides(crewId).catch(() => {});
  }, [crewId, loadRides]);

  function reset() {
    setDriver('');
    setSeats('');
    setDepartFrom('');
    setDepartAt('');
    setNote('');
    setShowForm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (createBusy) return;
    const d = driver.trim();
    const from = departFrom.trim();
    const at = departAt.trim();
    const n = note.trim();
    const seatsNum = seats.trim() ? Number(seats.trim()) : null;
    // Require at least one meaningful field so we don't post an empty offer.
    if (!d && !from && !at && !n && seatsNum == null) return;
    setCreateBusy(true);
    try {
      await createRideOffer(crewId, {
        driver: d || null,
        seats: seatsNum != null && Number.isFinite(seatsNum) ? seatsNum : null,
        departFrom: from || null,
        departAt: at || null,
        note: n || null,
      });
      toast('Ride posted', 'success');
      reset();
    } catch (err) {
      warning();
      toast(err instanceof Error ? err.message : 'Failed to post', 'error');
    } finally {
      setCreateBusy(false);
    }
  }

  async function remove(offerId: string) {
    setBusyId(offerId);
    try {
      await deleteRideOffer(crewId, offerId);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to remove', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const canSubmit = !!driver.trim() || !!departFrom.trim() || !!departAt.trim() || !!note.trim() || !!seats.trim();

  return (
    <div className="space-y-3 px-4">
      {!showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
          <Plus className="w-4 h-4" aria-hidden="true" /> Post a ride
        </Button>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New ride</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input
            label="Driver"
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
            placeholder="Who's driving?"
            maxLength={100}
          />
          <Input
            label="Seats"
            type="number"
            min={0}
            max={99}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            placeholder="Open seats"
          />
          <Input
            label="Leaving from"
            value={departFrom}
            onChange={(e) => setDepartFrom(e.target.value)}
            placeholder="Pickup spot"
            maxLength={200}
          />
          <Input
            label="When"
            value={departAt}
            onChange={(e) => setDepartAt(e.target.value)}
            placeholder="Fri 2pm"
            maxLength={100}
          />
          <Input
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything else?"
            maxLength={500}
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={createBusy}
            className="w-full min-h-11"
            disabled={!canSubmit}
          >
            Post ride
          </Button>
        </form>
      )}

      {offers.length === 0 ? (
        <EmptyState
          icon={<Car className="w-12 h-12" aria-hidden="true" />}
          title="No rides yet"
          description="Post a carpool — who's driving, how many seats, and where you're leaving from — so your crew can ride together."
        />
      ) : (
        <ul className="space-y-2">
          {offers.map((offer) => {
            const canRemove = offer.created_by === currentUserId || isOwner;
            const title = offer.driver || 'Ride offer';
            return (
              <li key={offer.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-bg-card border border-border">
                <div className="flex-shrink-0 w-6 h-6 rounded-md bg-accent-aqua/15 border border-accent-aqua/30 text-accent-aqua flex items-center justify-center">
                  <Car className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate">{title}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {typeof offer.seats === 'number' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        {offer.seats} seat{offer.seats === 1 ? '' : 's'}
                      </span>
                    ) : null}
                    {offer.depart_from ? (
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary truncate">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {offer.depart_from}
                      </span>
                    ) : null}
                    {offer.depart_at ? <span className="text-xs text-text-secondary">{offer.depart_at}</span> : null}
                  </div>
                  {offer.note ? <p className="text-xs text-text-muted mt-0.5 break-words">{offer.note}</p> : null}
                </div>
                {canRemove ? (
                  <IconButton
                    label="Remove ride"
                    variant="danger"
                    icon={<Trash2 className="w-4 h-4" />}
                    onClick={() => remove(offer.id)}
                    disabled={busyId === offer.id}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

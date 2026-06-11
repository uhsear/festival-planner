import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useCrewStore } from '@festie/shared/stores';
import { useAuthStore } from '@festie/shared/stores';
import { useFestivalStore } from '@festie/shared/stores';
import CrewSelector from '../components/features/CrewSelector';
import FreshnessChip from '../components/features/FreshnessChip';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import HomeBaseCard from '../components/crew/HomeBaseCard';
import CrewPhotosCard from '../components/crew/CrewPhotosCard';
import CrewInviteBar from '../components/crew/CrewInviteBar';
import ReformCrewButton from '../components/crew/ReformCrewButton';
import CrewTabBar from '../components/crew/CrewTabBar';
import CrewTabContent from '../components/crew/CrewTabContent';
import { useCrewAdmin } from '../components/crew/useCrewAdmin';
import { useToast } from '../lib/toastContext';
import PromptDialog from '../components/ui/PromptDialog';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { Users, Columns3, Trash2, LogOut, CalendarClock, ChevronRight } from 'lucide-react';
import type { Crew, CrewMember } from '@festie/shared/types';
import type { TabKey } from '../components/crew/CrewTabBar';

interface CrewWithHomeBase extends Crew {
  createdBy?: string;
}

export default function CrewView() {
  return (
    <RenderErrorBoundary name="crew">
      <CrewViewInner />
    </RenderErrorBoundary>
  );
}

function CrewViewInner() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const crews = useCrewStore((state) => state.crews);
  const activeCrew = useCrewStore((state) => state.activeCrew);
  const selectCrew = useCrewStore((state) => state.selectCrew);
  const createCrew = useCrewStore((state) => state.createCrew);
  const joinByCode = useCrewStore((state) => state.joinByCode);
  const leaveCrew = useCrewStore((state) => state.leaveCrew);
  const deleteCrew = useCrewStore((state) => state.deleteCrew);
  const kickMember = useCrewStore((state) => state.kickMember);
  const transferOwnership = useCrewStore((state) => state.transferOwnership);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const [tab, setTab] = useState<TabKey>('members');
  const { toast } = useToast();

  const { isAdmin, adminOpen, setAdminOpen, adminAddBusy, submitForceAdd, handleForceAdd } = useCrewAdmin(
    user,
    activeCrew?.id,
    toast,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [kickTarget, setKickTarget] = useState<CrewMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<CrewMember | null>(null);

  useEffect(() => {
    if (user && crews.length > 0 && !activeCrew) {
      selectCrew(crews[0]!.id).catch(() => {});
    }
  }, [user?.id, crews, activeCrew, selectCrew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) navigate({ to: '/login' }).catch(() => {});
  }, [user, navigate]);

  // Tab badge counts. These reuse the exact query keys + endpoints the Polls
  // and Expenses tabs use, so the data is shared from the react-query cache
  // (no extra backend calls beyond what the crew detail view already makes).
  // Declared before the early return below to keep hook order stable.
  const activeCrewId = activeCrew?.id;
  const userId = user?.id;
  const { data: openPollCount = 0 } = useQuery({
    queryKey: ['polls', activeCrewId],
    queryFn: async () => {
      const res = await api.get<{ polls: { closed?: boolean }[] } | { closed?: boolean }[]>(
        `/crews/${activeCrewId}/polls`,
      );
      return Array.isArray(res) ? res : res?.polls || [];
    },
    enabled: !!activeCrewId,
    select: (list) => list.filter((p) => !p.closed).length,
  });
  const { data: hasUnsettledBalance = false } = useQuery({
    queryKey: ['expense-balances', activeCrewId],
    queryFn: async () => {
      const res = await api.get<
        { userId: string; balance: number }[] | { balances: { userId: string; balance: number }[] }
      >(`/crews/${activeCrewId}/expenses/balances`);
      return Array.isArray(res) ? res : res?.balances || [];
    },
    enabled: !!activeCrewId,
    select: (balances) => Math.abs(balances.find((b) => b.userId === userId)?.balance ?? 0) > 0.01,
  });

  if (!user) return null;

  const handleSelectCrew = (crewId: string) => {
    selectCrew(crewId).catch((e: unknown) => {
      toast(e instanceof Error ? e.message : "Couldn't select crew. Try again.", 'error');
    });
  };
  const handleCreateCrew = () => setCreateOpen(true);
  const submitCreateCrew = async (name: string) => {
    setCreateBusy(true);
    try {
      await createCrew({ name, festivalId: currentFestival?.id });
      setCreateOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't create crew. Try again.", 'error');
    } finally {
      setCreateBusy(false);
    }
  };

  const handleJoinCrew = () => setJoinOpen(true);
  const submitJoinCrew = async (inviteCode: string) => {
    setJoinBusy(true);
    try {
      await joinByCode({ inviteCode });
      setJoinOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't join crew. Try again.", 'error');
    } finally {
      setJoinBusy(false);
    }
  };

  const submitDestroy = async () => {
    if (!activeCrew) return;
    setConfirmBusy(true);
    try {
      if (isOwner) {
        await deleteCrew(activeCrew.id);
        toast('Crew deleted', 'success');
      } else {
        await leaveCrew(activeCrew.id);
        toast('Left crew', 'success');
      }
      setConfirmOpen(false);
    } catch (e) {
      toast(
        e instanceof Error
          ? e.message
          : isOwner
            ? "Couldn't delete crew. Try again."
            : "Couldn't leave crew. Try again.",
        'error',
      );
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleTransferOwnership = (member: CrewMember) => {
    if (!activeCrew) return;
    setTransferTarget(member);
  };

  const submitTransferOwnership = () => {
    if (!activeCrew || !transferTarget) return;
    transferOwnership(activeCrew.id, transferTarget.userId)
      .then(() => selectCrew(activeCrew.id))
      .catch((e: unknown) => {
        toast(e instanceof Error ? e.message : "Couldn't transfer ownership. Try again.", 'error');
      })
      .finally(() => setTransferTarget(null));
  };

  const handleKick = (member: CrewMember) => {
    if (!activeCrew) return;
    setKickTarget(member);
  };

  const submitKick = () => {
    if (!activeCrew || !kickTarget) return;
    kickMember(activeCrew.id, kickTarget.userId)
      .then(() => selectCrew(activeCrew.id))
      .catch((e: unknown) => {
        toast(e instanceof Error ? e.message : "Couldn't remove member. Try again.", 'error');
      })
      .finally(() => setKickTarget(null));
  };

  const crew = activeCrew as CrewWithHomeBase | null;
  const members = crew?.members || [];
  const meMember = members.find((m) => m.userId === user.id);
  const isOwner = meMember?.role === 'owner' || crew?.createdBy === user.id || crew?.owner === user.id;

  return (
    <div className="crew-page space-y-4 pb-6 max-w-[600px] mx-auto min-w-0 w-full">
      {crews.length > 0 && (
        <CrewSelector
          crews={crews}
          selectedCrewId={activeCrew?.id}
          onSelectCrew={handleSelectCrew}
          onCreateCrew={handleCreateCrew}
          onJoinCrew={handleJoinCrew}
        />
      )}

      {!activeCrew ? (
        <Card padding="lg" className="space-y-4">
          <EmptyState
            icon={<Users className="w-12 h-12" aria-hidden="true" />}
            title="No crew yet"
            description="Create a crew or join an existing one to coordinate with friends"
          />
          {crews.length === 0 && (
            <div className="flex gap-4">
              <Button variant="primary" onClick={handleCreateCrew} className="flex-1 min-h-11">
                Create Crew
              </Button>
              <Button variant="outline" onClick={handleJoinCrew} className="flex-1 min-h-11">
                Join by Code
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="crew-content space-y-4 min-w-0">
          <FreshnessChip surface="crew" />

          <HomeBaseCard
            crewId={activeCrew.id}
            currentLocation={crew?.homeBaseLocation ?? null}
            currentTime={crew?.homeBaseTime ?? null}
            isOwner={isOwner}
            onSaved={() => selectCrew(activeCrew.id)}
          />

          <CrewPhotosCard
            crewId={activeCrew.id}
            currentUrl={crew?.photoAlbumUrl ?? null}
            onSaved={() => selectCrew(activeCrew.id)}
          />

          {activeCrew.inviteCode && (
            <CrewInviteBar inviteCode={activeCrew.inviteCode} crewId={activeCrew.id} isOwner={isOwner} />
          )}

          <ReformCrewButton
            crewId={activeCrew.id}
            sourceFestivalId={activeCrew.festivalId}
            crewName={activeCrew.name}
          />

          <Link
            to="/crew-plan"
            aria-label="View your crew's plan"
            className="flex items-center gap-2 py-2 px-4 min-h-11 rounded-full bg-accent-aqua text-[var(--text-on-light-accent)] hover:bg-[var(--color-accent-aqua-hover)] transition-colors duration-[var(--duration-med)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          >
            <CalendarClock className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Crew plan</span>
            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0" aria-hidden="true" />
          </Link>

          <Link
            to="/compare"
            aria-label="Compare crew schedules"
            className="flex items-center gap-2 py-2 px-4 min-h-11 rounded-full bg-transparent border border-accent-aqua/50 text-accent-aqua hover:bg-[var(--color-aqua-a08)] transition-colors duration-[var(--duration-med)] ease-[var(--ease-out)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          >
            <Columns3 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold">Compare schedules</span>
            <ChevronRight className="w-4 h-4 ml-auto flex-shrink-0" aria-hidden="true" />
          </Link>

          <CrewTabBar
            activeTab={tab}
            onTabChange={setTab}
            badges={{ polls: openPollCount, expenses: hasUnsettledBalance }}
          />

          <CrewTabContent
            tab={tab}
            crewId={activeCrew.id}
            currentUserId={user.id}
            isOwner={isOwner}
            isAdmin={isAdmin}
            adminAddBusy={adminAddBusy}
            members={members}
            ownerId={activeCrew.owner}
            onForceAdd={handleForceAdd}
            onTransferOwnership={handleTransferOwnership}
            onKick={handleKick}
          />

          <div className="pt-2">
            <Button variant="danger" fullWidth onClick={() => setConfirmOpen(true)} className="min-h-11">
              {isOwner ? (
                <>
                  <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete crew
                </>
              ) : (
                <>
                  <LogOut className="w-4 h-4" aria-hidden="true" /> Leave crew
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <PromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New crew"
        description="Give your crew a name. You can invite others after."
        placeholder="Sunset Squad"
        confirmLabel="Create"
        busy={createBusy}
        maxLength={60}
        onConfirm={submitCreateCrew}
      />
      <PromptDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        title="Join crew"
        description="Paste the 6-letter invite code your friend shared."
        placeholder="A1B2C3"
        confirmLabel="Join"
        busy={joinBusy}
        maxLength={20}
        onConfirm={submitJoinCrew}
      />
      <PromptDialog
        open={adminOpen}
        onOpenChange={setAdminOpen}
        title="Force add member"
        description="Admin only. Type a username or email to add them without an invite code."
        placeholder="username or email"
        confirmLabel="Add"
        busy={adminAddBusy}
        onConfirm={submitForceAdd}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isOwner ? 'Delete crew' : 'Leave crew'}
        description={
          isOwner
            ? 'This permanently deletes the crew for everyone. Continue?'
            : 'Are you sure you want to leave this crew?'
        }
        confirmLabel={isOwner ? 'Delete' : 'Leave'}
        destructive
        busy={confirmBusy}
        onConfirm={submitDestroy}
      />
      <ConfirmDialog
        open={kickTarget !== null}
        onOpenChange={(open) => {
          if (!open) setKickTarget(null);
        }}
        title="Remove member"
        description={`Remove ${kickTarget?.name || kickTarget?.username || 'this member'} from the crew?`}
        confirmLabel="Remove"
        destructive
        onConfirm={submitKick}
      />
      <ConfirmDialog
        open={transferTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null);
        }}
        title="Transfer ownership"
        description={`Make ${transferTarget?.name || transferTarget?.username || 'this member'} the crew owner? You will become a regular member.`}
        confirmLabel="Make owner"
        onConfirm={submitTransferOwnership}
      />
    </div>
  );
}

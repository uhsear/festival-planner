import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCrewStore } from '@festie/shared/stores';
import { useAuthStore } from '@festie/shared/stores';
import { useFestivalStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import CrewSelector from '../components/features/CrewSelector';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import HomeBaseCard from '../components/crew/HomeBaseCard';
import MeetingPointsTab from '../components/crew/MeetingPointsTab';
import PollsTab from '../components/crew/PollsTab';
import ExpensesTab from '../components/crew/ExpensesTab';
import ActivityTab from '../components/crew/ActivityTab';
import MembersTab from '../components/crew/MembersTab';
import { useToast } from '../lib/toastContext';
import PromptDialog from '../components/ui/PromptDialog';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import {
  Users, Copy, MapPin, BarChart3, DollarSign, Activity, Columns3,
} from 'lucide-react';
import type { Crew, CrewMember } from '@festie/shared/types';

interface CrewWithHomeBase extends Crew {
  homeBaseLocation?: string | null;
  homeBaseTime?: string | null;
  homeBaseUpdatedAt?: string | null;
  createdBy?: string;
}

interface CrewMemberWithUsername extends CrewMember {
  username?: string;
}

type TabKey = 'members' | 'meeting' | 'polls' | 'expenses' | 'activity';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'members',  label: 'Members',  icon: <Users       className="w-4 h-4" aria-hidden="true" /> },
  { key: 'meeting',  label: 'Meet',     icon: <MapPin      className="w-4 h-4" aria-hidden="true" /> },
  { key: 'polls',    label: 'Polls',    icon: <BarChart3   className="w-4 h-4" aria-hidden="true" /> },
  { key: 'expenses', label: 'Expenses', icon: <DollarSign  className="w-4 h-4" aria-hidden="true" /> },
  { key: 'activity', label: 'Activity', icon: <Activity    className="w-4 h-4" aria-hidden="true" /> },
];

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
  const forceAddMember = useCrewStore((state) => state.forceAddMember);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const [copiedCode, setCopiedCode] = useState(false);
  const [tab, setTab] = useState<TabKey>('members');
  const { toast } = useToast();

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cleanup copy-feedback timer on unmount
  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  const [createOpen, setCreateOpen]     = useState(false);
  const [createBusy, setCreateBusy]     = useState(false);
  const [joinOpen, setJoinOpen]         = useState(false);
  const [joinBusy, setJoinBusy]         = useState(false);
  const [adminOpen, setAdminOpen]       = useState(false);

  const [isAdmin, setIsAdmin] = useState(false);
  const [adminAddBusy, setAdminAddBusy] = useState(false);
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const me = await api.get<{ roles?: Array<string | { role?: string; name?: string }> }>('/auth/me');
        const roles = (me?.roles ?? []) as Array<string | { role?: string; name?: string }>;
        const admin = roles.some((r) => typeof r === 'string' ? r === 'admin' : r.role === 'admin' || r.name === 'admin');
        if (!cancelled) setIsAdmin(admin);
      } catch {/* ignore */}
    })();
    return () => { cancelled = true; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only check admin role on login

  useEffect(() => {
    if (user && crews.length > 0 && !activeCrew) {
      selectCrew(crews[0]!.id).catch(() => {});
    }
  }, [user?.id, crews, activeCrew, selectCrew]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: use user.id to avoid re-running on every user object change

  const submitForceAdd = useCallback(async (query: string) => {
    if (!activeCrew) return;
    setAdminAddBusy(true);
    try {
      const users = await api.get<Array<{ id: string; username: string; email: string | null }>>(
        `/admin/users?search=${encodeURIComponent(query)}`,
      );
      if (!users || users.length === 0) { toast('No matching user found', 'error'); return; }
      const exact = users.find((u) => u.username.toLowerCase() === query.toLowerCase());
      const target = exact || users[0]!;
      if (!exact && users.length > 1) {
        const confirmed = window.confirm(`Found ${users.length} users. Add "${target.username}"?`);
        if (!confirmed) return;
      }
      await forceAddMember(activeCrew.id, target.id);
      await selectCrew(activeCrew.id);
      toast(`Added ${target.username}`, 'success');
      setAdminOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      if (/already/i.test(msg)) toast('User is already in this crew', 'info');
      else toast(msg, 'error');
    } finally { setAdminAddBusy(false); }
  }, [activeCrew, forceAddMember, selectCrew, toast]);

  useEffect(() => {
    if (!user) navigate({ to: '/login' }).catch(() => {});
  }, [user, navigate]);
  if (!user) return null;

  const handleSelectCrew = (crewId: string) => { selectCrew(crewId).catch(console.error); };
  const handleCreateCrew = () => setCreateOpen(true);
  const submitCreateCrew = async (name: string) => {
    setCreateBusy(true);
    try {
      await createCrew({ name, festivalId: currentFestival?.id });
      setCreateOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to create crew', 'error');
    } finally { setCreateBusy(false); }
  };

  const handleJoinCrew = () => setJoinOpen(true);
  const submitJoinCrew = async (inviteCode: string) => {
    setJoinBusy(true);
    try {
      await joinByCode({ inviteCode });
      setJoinOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to join', 'error');
    } finally { setJoinBusy(false); }
  };

  const handleCopyInviteCode = () => {
    if (activeCrew?.inviteCode) {
      const url = `${window.location.origin}/api/v1/crews/join/${activeCrew.inviteCode}`;
      navigator.clipboard?.writeText(url);
      setCopiedCode(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleForceAdd = () => setAdminOpen(true);

  const crew = activeCrew as CrewWithHomeBase | null;
  const members = (crew?.members || []) as CrewMemberWithUsername[];
  const meMember = members.find((m) => m.userId === user.id);
  const isOwner = (meMember?.role === 'owner') || crew?.createdBy === user.id || crew?.owner === user.id;

  return (
    <div className="crew-page space-y-2 pb-20 max-w-2xl mx-auto px-3 min-w-0 w-full">
      {crews.length > 0 && (
        <CrewSelector crews={crews} selectedCrewId={activeCrew?.id}
          onSelectCrew={handleSelectCrew} onCreateCrew={handleCreateCrew} onJoinCrew={handleJoinCrew} />
      )}

      {!activeCrew ? (
        <div className="px-4">
          <EmptyState icon={<Users className="w-12 h-12" aria-hidden="true" />} title="No crew yet"
            description="Create a crew or join an existing one to coordinate with friends" />
          {crews.length === 0 && (
            <div className="mt-6 flex gap-3">
              <Button variant="primary" onClick={handleCreateCrew} className="flex-1 min-h-11">Create Crew</Button>
              <Button variant="outline" onClick={handleJoinCrew} className="flex-1 min-h-11">Join by Code</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="crew-content space-y-2 min-w-0">
          <HomeBaseCard
            crewId={activeCrew.id}
            currentLocation={crew?.homeBaseLocation ?? null}
            currentTime={crew?.homeBaseTime ?? null}
            isOwner={isOwner}
            onSaved={() => selectCrew(activeCrew.id)}
          />

          {activeCrew.inviteCode && (
            <div className="py-1.5 px-2 rounded-lg bg-bg-card border border-border flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-text-muted flex-shrink-0" aria-hidden="true" />
              <span className="text-xs text-text-secondary truncate">
                Invite: <span className="text-text-primary font-mono">{activeCrew.inviteCode}</span>
              </span>
              <Button variant={copiedCode ? 'primary' : 'outline'} onClick={handleCopyInviteCode}
                className={`!py-1 !px-2.5 text-xs ml-auto flex-shrink-0 ${copiedCode ? 'crew-copy-success' : ''}`}>
                {copiedCode ? '✓' : 'Copy'}
              </Button>
            </div>
          )}

          <Link
            to="/compare"
            className="flex items-center gap-2 py-1.5 px-2 min-h-11 rounded-lg bg-accent-aqua/10 border border-accent-aqua/30 hover:bg-accent-aqua/15 transition-colors"
          >
            <Columns3 className="w-4 h-4 text-accent-aqua flex-shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold text-text-primary">Compare schedules</span>
            <span className="text-accent-aqua text-xs ml-auto">{'→'}</span>
          </Link>

          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pr-4 scrollbar-hide min-w-0 max-w-full" role="tablist" aria-label="Crew tabs">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key}
                id={`crew-tab-${t.key}`}
                aria-controls="crew-tab-panel"
                onClick={() => setTab(t.key)}
                className={`flex-shrink-0 px-2.5 py-1.5 min-h-11 rounded-md flex items-center gap-1 text-xs font-medium whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? 'bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/30'
                    : 'bg-bg-card text-text-secondary border border-border hover:border-border-light'
                }`}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          <div className="crew-tab-panel" key={tab} role="tabpanel" id="crew-tab-panel" aria-labelledby={`crew-tab-${tab}`}>
            {tab === 'members' && (
              <MembersTab
                members={members}
                ownerId={activeCrew.owner}
                isAdmin={isAdmin}
                adminAddBusy={adminAddBusy}
                onForceAdd={handleForceAdd}
              />
            )}
            {tab === 'meeting' && (
              <MeetingPointsTab crewId={activeCrew.id} currentUserId={user.id} />
            )}
            {tab === 'polls' && (
              <PollsTab crewId={activeCrew.id} currentUserId={user.id} isOwner={isOwner} />
            )}
            {tab === 'expenses' && (
              <ExpensesTab crewId={activeCrew.id} members={members} currentUserId={user.id} />
            )}
            {tab === 'activity' && (
              <ActivityTab crewId={activeCrew.id} />
            )}
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
    </div>
  );
}

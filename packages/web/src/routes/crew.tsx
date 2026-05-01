import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCrewStore } from '@festie/shared/stores';
import { useAuthStore } from '@festie/shared/stores';
import { useFestivalStore } from '@festie/shared/stores';
import { api } from '@festie/shared/services';
import CrewSelector from '../components/features/CrewSelector';
import EmptyState from '../components/ui/EmptyState';
import Avatar from '../components/ui/Avatar';
import Button from '../components/ui/Button';
import HomeBaseCard from '../components/crew/HomeBaseCard';
import MeetingPointsTab from '../components/crew/MeetingPointsTab';
import PollsTab from '../components/crew/PollsTab';
import ExpensesTab from '../components/crew/ExpensesTab';
import ActivityTab from '../components/crew/ActivityTab';
import { useToast } from '../lib/toastContext';
import PromptDialog from '../components/ui/PromptDialog';
import {
  Users, Copy, UserPlus, MapPin, BarChart3, DollarSign, Activity, Columns3,
} from 'lucide-react';
import type { Crew, CrewMember } from '@festie/shared/types';

/** Extended crew shape matching what the API actually returns (includes home
 *  base fields and legacy ownership field not yet in the shared Crew type). */
interface CrewWithHomeBase extends Crew {
  homeBaseLocation?: string | null;
  homeBaseTime?: string | null;
  homeBaseUpdatedAt?: string | null;
  createdBy?: string;
}

/** Extended member shape — the server serializes `username` alongside `name`. */
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

  // Prompt dialogs — Radix-based replacements for three blocking window.prompt
  // calls. Only one is open at a time; each handler reads/writes its slice
  // of state. Keeping them colocated with CrewView avoids lifting state up.
  const [createOpen, setCreateOpen]     = useState(false);
  const [createBusy, setCreateBusy]     = useState(false);
  const [joinOpen, setJoinOpen]         = useState(false);
  const [joinBusy, setJoinBusy]         = useState(false);
  const [adminOpen, setAdminOpen]       = useState(false);

  // Admin role check — drives both force-add visibility + poll close on any poll.
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
  }, [user?.id]);

  useEffect(() => {
    if (user && crews.length > 0 && !activeCrew) {
      selectCrew(crews[0].id).catch(() => {});
    }
  }, [user?.id, crews, activeCrew, selectCrew]);

  // /crew is a logged-in-only surface — see router.tsx beforeLoad guard.
  // This effect catches the logged-out-while-on-route edge case so we never
  // render the page to a guest after an in-session logout.
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
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleForceAdd = () => setAdminOpen(true);
  const submitForceAdd = useCallback(async (query: string) => {
    if (!activeCrew) return;
    setAdminAddBusy(true);
    try {
      const users = await api.get<Array<{ id: string; username: string; email: string | null }>>(
        `/admin/users?search=${encodeURIComponent(query)}`,
      );
      if (!users || users.length === 0) { toast('No matching user found', 'error'); return; }
      const exact = users.find((u) => u.username.toLowerCase() === query.toLowerCase());
      const target = exact || users[0];
      // Ambiguous match guard — kept as a native confirm since it's a
      // rare admin-only path and doesn't warrant a second Radix dialog.
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

  const crew = activeCrew as CrewWithHomeBase | null;
  const members = (crew?.members || []) as CrewMemberWithUsername[];
  // Owner = server 'role === "owner"' OR legacy 'createdBy' match.
  const meMember = members.find((m) => m.userId === user.id);
  const isOwner = (meMember?.role === 'owner') || crew?.createdBy === user.id || crew?.owner === user.id;

  return (
    // max-w-2xl matches /account's comfortable reading width on desktop —
    // before this, the crew tabs + invite bar stretched the full 1400px and
    // the member list cards ran all the way to the edges, which read as
    // under-designed rather than immersive.
    <div className="crew-page space-y-4 pb-24 max-w-2xl mx-auto">
      {crews.length > 0 && (
        <CrewSelector crews={crews} selectedCrewId={activeCrew?.id}
          onSelectCrew={handleSelectCrew} onCreateCrew={handleCreateCrew} onJoinCrew={handleJoinCrew} />
      )}

      {!activeCrew ? (
        <div className="px-4">
          {/* EmptyState renders without a cta prop — the paired
             "Create Crew / Join by Code" row below is the primary + secondary
             action pair. Having both the EmptyState's lone CTA AND the row
             underneath showed two identical "Create Crew" buttons stacked on
             top of each other, which read as a rendering glitch. */}
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
        <div className="crew-content space-y-4 px-4">
          {/* Home base — pinned at the top so the crew always sees where to meet. */}
          <HomeBaseCard
            crewId={activeCrew.id}
            currentLocation={crew?.homeBaseLocation ?? null}
            currentTime={crew?.homeBaseTime ?? null}
            isOwner={isOwner}
            onSaved={() => selectCrew(activeCrew.id)}
          />

          {/* Invite link — compact */}
          <div className="p-3 rounded-lg bg-bg-card border border-border flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-muted uppercase tracking-wide flex items-center gap-1.5">
                <Copy className="w-3 h-3" aria-hidden="true" /> Invite link
              </div>
              <div className="text-xs text-text-secondary mt-0.5 truncate">
                Code: <span className="text-text-primary font-mono">{activeCrew.inviteCode}</span>
              </div>
            </div>
            <Button variant={copiedCode ? 'primary' : 'outline'} onClick={handleCopyInviteCode}
              className={`!py-1.5 !px-3 text-xs min-h-11 flex-shrink-0 ${copiedCode ? 'crew-copy-success' : ''}`}>
              {copiedCode ? '✓ Copied' : 'Copy'}
            </Button>
          </div>

          {/* Compare-schedules entry point — deep-links to /compare, which
             shows the side-by-side per-day table of who picked what. This
             replaces the legacy renderCrewSchedule view in public/views/crew.js. */}
          <Link
            to="/compare"
            className="flex items-center gap-3 p-3 rounded-lg bg-accent-aqua/10 border border-accent-aqua/30 hover:bg-accent-aqua/15 transition-colors min-h-11"
          >
            <Columns3 className="w-5 h-5 text-accent-aqua" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-text-primary">Compare schedules</div>
              <div className="text-xs text-text-secondary">See everyone's picks side by side</div>
            </div>
            <span className="text-accent-aqua text-sm">→</span>
          </Link>

          {/* Tab nav — horizontal scroll on narrow screens, 5 tabs fit on 390+ */}
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1 scrollbar-hide" role="tablist" aria-label="Crew tabs">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex-shrink-0 min-h-11 px-3 py-2 rounded-lg flex items-center gap-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? 'bg-accent-aqua/15 text-accent-aqua border border-accent-aqua/30'
                    : 'bg-bg-card text-text-secondary border border-border hover:border-border-light'
                }`}>
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content — keyed by `tab` so switching restarts the mount-fade
             defined in globals.css (.crew-tab-panel → card-in animation). */}
          <div className="-mx-4 crew-tab-panel" key={tab} role="tabpanel">
            {tab === 'members' && (
              <div className="space-y-3 px-4">
                {isAdmin && (
                  <div className="p-3 rounded-lg border border-accent-amber/40 bg-accent-amber/5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm text-accent-amber">
                      <UserPlus className="w-4 h-4" aria-hidden="true" />
                      <span className="font-semibold">Admin</span>
                      <span className="text-text-secondary text-xs">Force add</span>
                    </div>
                    <Button variant="outline" onClick={handleForceAdd} disabled={adminAddBusy}
                      className="!py-1.5 !px-3 text-xs min-h-11">
                      {adminAddBusy ? 'Adding…' : 'Force Add'}
                    </Button>
                  </div>
                )}
                {members.length > 0 ? (
                  <div className="space-y-2">
                    {members.map((m) => (
                      <div key={m.userId} className="crew-list-enter p-3 rounded-lg bg-bg-card border border-border flex items-center gap-3">
                        <Avatar name={m.name || m.username || 'User'} size="md" />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-text-primary truncate">{m.name || m.username}</div>
                          {(m.role === 'owner' || activeCrew.owner === m.userId) && (
                            <div className="text-xs text-accent-amber">👑 Owner</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={<Users className="w-12 h-12" aria-hidden="true" />} title="No members yet"
                    description="Invite friends with the code above — they'll appear here the moment they join." />
                )}
              </div>
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

      {/* Prompt dialogs — replaces blocking window.prompt calls */}
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

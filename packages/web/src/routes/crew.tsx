import React, { useState } from 'react';
import { useCrewStore } from '@festie/shared/stores';
import { useAuthStore } from '@festie/shared/stores';
import { useFestivalStore } from '@festie/shared/stores';
import { usePicks } from '@festie/shared/hooks';
import GuestTeaser from '../components/features/GuestTeaser';
import CrewSelector from '../components/features/CrewSelector';
import EmptyState from '../components/ui/EmptyState';
import Avatar from '../components/ui/Avatar';
import Button from '../components/ui/Button';
import { Users, Copy, Settings } from 'lucide-react';

export default function CrewView() {
  const user = useAuthStore((state) => state.user);
  const crews = useCrewStore((state) => state.crews);
  const activeCrew = useCrewStore((state) => state.activeCrew);
  const selectCrew = useCrewStore((state) => state.selectCrew);
  const createCrew = useCrewStore((state) => state.createCrew);
  const joinByCode = useCrewStore((state) => state.joinByCode);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!user) {
    return <GuestTeaser mode="crew" />;
  }

  const handleSelectCrew = (crewId: string) => {
    selectCrew(crewId).catch(console.error);
  };

  const handleCreateCrew = async () => {
    const name = window.prompt('Crew name:');
    if (!name) return;
    try {
      await createCrew({ name, festivalId: currentFestival?.id });
    } catch (e) {
      console.error(e);
    }
  };

  const handleJoinCrew = async () => {
    const inviteCode = window.prompt('Enter invite code:');
    if (!inviteCode) return;
    try {
      await joinByCode({ inviteCode });
    } catch (e) {
      console.error(e);
    }
  };

  const handleCopyInviteCode = () => {
    if (activeCrew?.inviteCode) {
      const inviteUrl = `${window.location.origin}/api/v1/crews/join/${activeCrew.inviteCode}`;
      navigator.clipboard?.writeText(inviteUrl);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  return (
    <div className="crew-view space-y-4 pb-24">
      {/* Crew selector */}
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
        <div className="px-4">
          <EmptyState
            icon={<Users className="w-12 h-12" />}
            title="No crew yet"
            description="Create a crew or join an existing one to coordinate with friends"
            cta={{
              label: 'Create Crew',
              onClick: handleCreateCrew,
            }}
          />

          {crews.length === 0 && (
            <div className="mt-6 flex gap-3">
              <Button variant="primary" onClick={handleCreateCrew} className="flex-1">
                Create Crew
              </Button>
              <Button variant="outline" onClick={handleJoinCrew} className="flex-1">
                Join by Code
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4 px-4">
          {/* Invite link section */}
          <div className="p-4 rounded-lg bg-bg-card border border-border">
            <h3 className="font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Copy className="w-4 h-4" />
              Invite Friends
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              Share this link to invite friends to your crew
            </p>
            <Button
              variant={copiedCode ? 'primary' : 'outline'}
              onClick={handleCopyInviteCode}
              className="w-full"
            >
              {copiedCode ? '✓ Copied!' : 'Copy Invite Link'}
            </Button>
          </div>

          {/* Crew members section */}
          <div>
            <h3 className="font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Members
              {activeCrew.members && (
                <span className="text-sm text-text-secondary ml-auto">
                  {activeCrew.members.length}
                </span>
              )}
            </h3>

            {activeCrew.members && activeCrew.members.length > 0 ? (
              <div className="space-y-2">
                {activeCrew.members.map((member) => (
                  <div key={member.id} className="p-3 rounded-lg bg-bg-card border border-border flex items-center gap-3">
                    <Avatar name={member.name || 'User'} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-text-primary">{member.name || 'User'}</div>
                      {(member.role === 'owner' || activeCrew.owner === member.userId) && (
                        <div className="text-xs text-accent-amber">👑 Owner</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-text-muted">
                <p>No members yet. Invite friends to join!</p>
              </div>
            )}
          </div>

          {/* Crew settings */}
          {user && activeCrew.owner === user.id && (
            <Button variant="outline" className="w-full flex items-center gap-2 justify-center">
              <Settings className="w-4 h-4" />
              Crew Settings
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

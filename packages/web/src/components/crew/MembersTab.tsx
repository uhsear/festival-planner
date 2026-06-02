import React from 'react';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Users, UserPlus, Crown } from 'lucide-react';
import type { CrewMember } from '@festie/shared/types';

export interface MembersTabProps {
  members: CrewMember[];
  ownerId: string | undefined;
  isAdmin: boolean;
  adminAddBusy: boolean;
  onForceAdd: () => void;
  isOwner: boolean;
  currentUserId: string;
  onTransferOwnership: (member: CrewMember) => void;
}

export default function MembersTab({
  members,
  ownerId,
  isAdmin,
  adminAddBusy,
  onForceAdd,
  isOwner,
  currentUserId,
  onTransferOwnership,
}: MembersTabProps) {
  return (
    <div className="space-y-1.5">
      {isAdmin && (
        <div className="py-1.5 px-2 rounded-md border border-accent-amber/40 bg-accent-amber/5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-accent-amber">
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="font-semibold">Admin</span>
          </div>
          <Button variant="outline" onClick={onForceAdd} disabled={adminAddBusy} className="!py-1 !px-2.5 text-xs">
            {adminAddBusy ? 'Adding…' : 'Force Add'}
          </Button>
        </div>
      )}
      {members.length > 0 ? (
        <div className="space-y-0.5">
          {members.map((m) => {
            const memberIsOwner = m.role === 'owner' || ownerId === m.userId;
            const canTransfer = isOwner && !memberIsOwner && m.userId !== currentUserId;
            const displayName = m.name || m.username || 'User';
            return (
              <div
                key={m.userId}
                className="py-2 px-2.5 rounded-md bg-bg-card border border-border flex items-center gap-2.5 animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
              >
                <Avatar name={displayName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary truncate">{m.name || m.username}</div>
                  {memberIsOwner && <div className="text-xs text-accent-amber">{'👑'} Owner</div>}
                </div>
                {canTransfer && (
                  <Button
                    variant="outline"
                    onClick={() => onTransferOwnership(m)}
                    aria-label={`Make ${displayName} the owner`}
                    className="!py-1 !px-2.5 text-xs"
                  >
                    <Crown className="w-3.5 h-3.5" aria-hidden="true" /> Make owner
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="No members yet"
          description="Invite friends with the code above — they'll appear here the moment they join."
        />
      )}
    </div>
  );
}

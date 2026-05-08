import React from 'react';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Users, UserPlus } from 'lucide-react';

interface CrewMemberWithUsername {
  userId: string;
  name?: string;
  username?: string;
  role?: string;
}

export interface MembersTabProps {
  members: CrewMemberWithUsername[];
  ownerId: string | undefined;
  isAdmin: boolean;
  adminAddBusy: boolean;
  onForceAdd: () => void;
}

export default function MembersTab({
  members,
  ownerId,
  isAdmin,
  adminAddBusy,
  onForceAdd,
}: MembersTabProps) {
  return (
    <div className="space-y-1.5">
      {isAdmin && (
        <div className="py-1.5 px-2 rounded-md border border-accent-amber/40 bg-accent-amber/5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-accent-amber">
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="font-semibold">Admin</span>
          </div>
          <Button
            variant="outline"
            onClick={onForceAdd}
            disabled={adminAddBusy}
            className="!py-1 !px-2.5 text-xs"
          >
            {adminAddBusy ? 'Adding…' : 'Force Add'}
          </Button>
        </div>
      )}
      {members.length > 0 ? (
        <div className="space-y-0.5">
          {members.map((m) => (
            <div
              key={m.userId}
              className="crew-list-enter py-2 px-2.5 rounded-md bg-bg-card border border-border flex items-center gap-2.5"
            >
              <Avatar name={m.name || m.username || 'User'} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-text-primary truncate">
                  {m.name || m.username}
                </div>
                {(m.role === 'owner' || ownerId === m.userId) && (
                  <div className="text-xs text-accent-amber">{'👑'} Owner</div>
                )}
              </div>
            </div>
          ))}
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

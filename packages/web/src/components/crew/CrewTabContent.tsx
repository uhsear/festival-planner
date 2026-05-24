import React from 'react';
import MembersTab from './MembersTab';
import MeetingPointsTab from './MeetingPointsTab';
import PollsTab from './PollsTab';
import ExpensesTab from './ExpensesTab';
import ActivityTab from './ActivityTab';
import type { TabKey } from './CrewTabBar';
import type { CrewMember } from '@festie/shared/types';

interface CrewMemberWithUsername extends CrewMember {
  username?: string;
}

interface CrewTabContentProps {
  tab: TabKey;
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
  isAdmin: boolean;
  adminAddBusy: boolean;
  members: CrewMemberWithUsername[];
  ownerId?: string;
  onForceAdd: () => void;
}

export default function CrewTabContent({
  tab,
  crewId,
  currentUserId,
  isOwner,
  isAdmin,
  adminAddBusy,
  members,
  ownerId,
  onForceAdd,
}: CrewTabContentProps) {
  return (
    <div
      className="crew-tab-panel animate-[card-in_200ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
      key={tab}
      role="tabpanel"
      id="crew-tab-panel"
      aria-labelledby={`crew-tab-${tab}`}
    >
      {tab === 'members' && (
        <MembersTab
          members={members}
          ownerId={ownerId}
          isAdmin={isAdmin}
          adminAddBusy={adminAddBusy}
          onForceAdd={onForceAdd}
        />
      )}
      {tab === 'meeting' && (
        <MeetingPointsTab crewId={crewId} currentUserId={currentUserId} />
      )}
      {tab === 'polls' && (
        <PollsTab crewId={crewId} currentUserId={currentUserId} isOwner={isOwner} />
      )}
      {tab === 'expenses' && (
        <ExpensesTab crewId={crewId} members={members} currentUserId={currentUserId} />
      )}
      {tab === 'activity' && (
        <ActivityTab crewId={crewId} />
      )}
    </div>
  );
}

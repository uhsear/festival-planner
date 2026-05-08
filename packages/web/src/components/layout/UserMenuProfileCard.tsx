import React from 'react';
import { getAvatarColor, getInitials } from '@festie/shared/utils';
import { useFestivalStore } from '@festie/shared';

interface UserMenuProfileCardProps {
  user: {
    username: string;
    name?: string;
    avatarUrl?: string;
    isAdmin?: boolean;
  };
}

export default function UserMenuProfileCard({ user }: UserMenuProfileCardProps) {
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const currentProfile = useFestivalStore((state) => state.currentProfile);

  const avatarName = user.username || user.name || '';

  // Compute pick/note stats from the current profile
  const summary = (() => {
    if (!currentProfile) return { total: 0, must: 0, want: 0, notes: 0 };
    const picks = currentProfile.picks || {};
    const notes = currentProfile.notes || {};
    let must = 0;
    let want = 0;
    for (const priority of Object.values(picks)) {
      if (priority === 'must') must++;
      else if (priority === 'want-to-see') want++;
    }
    return {
      total: Object.keys(picks).length,
      must,
      want,
      notes: Object.keys(notes).length,
    };
  })();

  return (
    <>
      {/* Profile card */}
      <div className="user-menu-profile-card" data-testid="user-menu-profile">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={avatarName}
            width={52}
            height={52}
            loading="lazy"
            decoding="async"
            className="h-[52px] w-[52px] rounded-full object-cover"
          />
        ) : (
          <div
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white"
            style={{ backgroundColor: getAvatarColor(avatarName) }}
          >
            {getInitials(avatarName)}
          </div>
        )}
        <div className="user-menu-copy">
          <div className="user-menu-name">{user.username}</div>
          <div className="user-menu-subline">Account identity across every festival</div>
          <div className="user-menu-badges">
            <span className="identity-badge">Account</span>
            {user.isAdmin && (
              <span className="identity-badge identity-badge-admin">Admin</span>
            )}
          </div>
        </div>
      </div>

      {/* Festival Profile section */}
      {currentFestival && (
        <section className="user-menu-section" data-testid="festival-profile-section">
          <div className="user-menu-section-title">Festival Profile</div>
          <div className="user-menu-section-copy">
            {currentProfile
              ? `Specific to ${currentFestival.name}. Picks, notes, and crew coordination live here.`
              : `You have not joined ${currentFestival.name} yet. Join when you are ready to save picks and coordinate with the crew.`}
          </div>
          <div className="user-menu-status">
            {currentProfile ? (
              <>
                <span className="identity-badge identity-badge-self">Joined</span>
                <span className="identity-badge">Notes stay private</span>
              </>
            ) : (
              <span className="identity-badge">Not joined</span>
            )}
          </div>
          {currentProfile && (
            <div className="user-menu-stats">
              {([
                [summary.total, 'Total picks'],
                [summary.must, 'Must see'],
                [summary.want, 'Want to see'],
                [summary.notes, 'Notes'],
              ] as const).map(([value, label]) => (
                <div className="user-menu-stat" key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

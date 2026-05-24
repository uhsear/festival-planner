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
      <div className="flex items-center gap-[var(--space-6)] px-0.5 pt-1 pb-3.5 border-b border-border mb-3" data-testid="user-menu-profile">
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
        <div className="flex flex-col gap-[5px] min-w-0">
          <div className="text-[15px] font-bold max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{user.username}</div>
          <div className="text-xs text-text-secondary max-w-full overflow-hidden text-ellipsis whitespace-nowrap">Account identity across every festival</div>
          <div className="flex flex-wrap gap-[var(--space-3)]">
            <span className="inline-flex items-center gap-[var(--space-2)] px-2 py-[3px] rounded-full bg-white/5 border border-border-light text-[11px] font-bold tracking-[.4px] uppercase text-text-secondary">Account</span>
            {user.isAdmin && (
              <span className="inline-flex items-center gap-[var(--space-2)] px-2 py-[3px] rounded-full bg-[rgba(var(--accent-coral-rgb),.12)] border border-[rgba(var(--accent-coral-rgb),.25)] text-[11px] font-bold tracking-[.4px] uppercase text-accent-coral">Admin</span>
            )}
          </div>
        </div>
      </div>

      {/* Festival Profile section */}
      {currentFestival && (
        <section className="pt-3 mt-3 border-t border-border first-of-type:pt-0 first-of-type:mt-0 first-of-type:border-t-0" data-testid="festival-profile-section">
          <div className="text-[11px] font-bold tracking-[1.2px] uppercase text-text-secondary mb-1.5">Festival Profile</div>
          <div className="text-xs text-text-secondary leading-[1.45] mb-2.5">
            {currentProfile
              ? `Specific to ${currentFestival.name}. Picks, notes, and crew coordination live here.`
              : `You have not joined ${currentFestival.name} yet. Join when you are ready to save picks and coordinate with the crew.`}
          </div>
          <div className="flex flex-wrap gap-[var(--space-3)] mb-2.5">
            {currentProfile ? (
              <>
                <span className="inline-flex items-center gap-[var(--space-2)] px-2 py-[3px] rounded-full bg-[var(--color-aqua-a1)] border border-[rgba(0,232,208,.28)] text-[11px] font-bold tracking-[.4px] uppercase text-accent-aqua">Joined</span>
                <span className="inline-flex items-center gap-[var(--space-2)] px-2 py-[3px] rounded-full bg-white/5 border border-border-light text-[11px] font-bold tracking-[.4px] uppercase text-text-secondary">Notes stay private</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-[var(--space-2)] px-2 py-[3px] rounded-full bg-white/5 border border-border-light text-[11px] font-bold tracking-[.4px] uppercase text-text-secondary">Not joined</span>
            )}
          </div>
          {currentProfile && (
            <div className="grid grid-cols-2 gap-[var(--space-4)] mb-3 max-[380px]:grid-cols-1">
              {([
                [summary.total, 'Total picks'],
                [summary.must, 'Must see'],
                [summary.want, 'Want to see'],
                [summary.notes, 'Notes'],
              ] as const).map(([value, label]) => (
                <div className="flex flex-col gap-[var(--space-1)] rounded-sm bg-[var(--color-overlay-2)] border border-border px-3 py-2.5" key={label}>
                  <strong className="text-base font-bold">{value}</strong>
                  <span className="text-[11px] text-text-secondary">{label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

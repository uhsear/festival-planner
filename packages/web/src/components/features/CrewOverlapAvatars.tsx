import { Priority } from '@festie/shared/types';
import { buildOverlapBreakdown } from '@festie/shared/utils';
import Avatar from '../ui/Avatar';
import { cn } from '@/lib/utils';

export interface OverlapFriend {
  profileId?: string;
  name?: string;
  initials?: string;
  avatarUrl?: string | null;
  priority: Priority;
}

interface Props {
  /** Priority-grouped friend list (must > want > maybe), already sorted by the caller. */
  friends: OverlapFriend[];
  /** Display name of the act, used to phrase the cluster's aria-label. */
  artistName: string;
  /** Extra classes for the outer button (e.g. spacing tweaks per host). */
  className?: string;
  /** Optional click handler; defaults to swallowing the event (decorative cluster). */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * Crew-overlap avatar cluster — the "who from your crew is going" pill shared by
 * the SetCard footer and the CrewSuggestionStrip so both render identically.
 *
 * Renders compact stacked avatars (must-first) with a +N overflow when crew
 * identity data is present, falling back to a bare "N going" count pill when it
 * isn't. The must > want > maybe breakdown is surfaced to screen readers via the
 * aria-label (shared buildOverlapBreakdown phrasing).
 */
export default function CrewOverlapAvatars({ friends, artistName, className, onClick }: Props) {
  if (friends.length === 0) return null;

  const hasAvatarData = friends.some((f) => f.name || f.initials || f.avatarUrl);
  const count = friends.length;
  const countLabel = count === 1 ? '1 going' : `${count} going`;
  const breakdown = buildOverlapBreakdown(friends);
  const ariaLabel =
    `${count} crew ${count === 1 ? 'member' : 'members'} going to ${artistName}` + (breakdown ? ` — ${breakdown}` : '');
  const visible = friends.slice(0, 3);
  const overflow = count - visible.length;

  return (
    <button
      className={cn(
        'card-overlap',
        'flex gap-2 items-center cursor-pointer',
        'bg-transparent border-0 p-0 text-inherit font-inherit appearance-none',
        'min-h-11 inline-flex',
        'focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2 focus-visible:rounded-sm',
        className,
      )}
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
    >
      {hasAvatarData ? (
        <span className="flex items-center" aria-hidden="true">
          {visible.map((f, i) => (
            <Avatar
              key={f.profileId ?? `${f.name ?? 'crew'}-${i}`}
              name={f.name || f.initials || 'Crew'}
              image={f.avatarUrl ?? undefined}
              size="xs"
              className={cn('ring-2 ring-bg-card rounded-full', i > 0 && '-ml-2')}
            />
          ))}
          {overflow > 0 && (
            <span
              className={cn(
                'flex-center -ml-2 w-6 h-6 rounded-full ring-2 ring-bg-card',
                'type-micro font-bold text-accent-aqua',
                'bg-[var(--color-aqua-a15)]',
              )}
            >
              +{overflow}
            </span>
          )}
        </span>
      ) : (
        <span
          className={cn(
            'type-micro font-bold text-accent-aqua',
            'bg-[var(--color-aqua-a15)] py-0.5 px-[7px] rounded-md',
            'whitespace-nowrap mr-0.5',
          )}
        >
          {countLabel}
        </span>
      )}
    </button>
  );
}

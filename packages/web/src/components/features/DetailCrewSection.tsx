import { getAvatarColor, getInitials } from '@festie/shared/utils';

interface OtherPick {
  profileId: string;
  name: string;
  avatar?: string;
  priority: string;
}

interface CrewNote {
  name: string;
  note: string;
}

interface Props {
  title: string;
  others: OtherPick[];
  crewNotes: CrewNote[];
}

const priLabels: Record<string, string> = {
  must: 'Must See',
  'want-to-see': 'Want to See',
  maybe: 'Maybe',
};

const priColors: Record<string, string> = {
  must: 'var(--priority-must)',
  'want-to-see': 'var(--priority-want)',
  maybe: 'var(--priority-maybe)',
};

export default function DetailCrewSection({ title, others, crewNotes }: Props) {
  return (
    <div className="detail-friends">
      <div className="detail-friends-title">{title}</div>
      <ul className="list-none m-0 p-0">
        {others.map((o) => {
          const avatarColor = getAvatarColor(o.name);
          const initials = getInitials(o.name);
          return (
            <li key={o.profileId} className="detail-friend-item">
              {o.avatar ? (
                <img
                  src={o.avatar}
                  alt={o.name}
                  width={28}
                  height={28}
                  loading="lazy"
                  decoding="async"
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                  title={o.name + ' (' + o.priority + ')'}
                />
              ) : (
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: avatarColor }}
                  title={o.name + ' (' + o.priority + ')'}
                >
                  {initials}
                </div>
              )}
              <span>{o.name}</span>
              <span className="friend-priority" style={{ color: priColors[o.priority] }}>{priLabels[o.priority]}</span>
            </li>
          );
        })}
      </ul>

      {crewNotes.length > 0 && (
        <div className="border-t border-[var(--border)] py-2">
          <div className="mb-1.5 text-xs font-semibold text-[var(--accent-aqua)]">
            Crew Notes
          </div>
          {crewNotes.map((cn) => (
            <div key={cn.name} className="py-1 text-[13px]">
              <strong className="text-[var(--text-secondary)]">{cn.name + ': '}</strong>
              {cn.note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

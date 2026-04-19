import React from 'react';
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
      {others.map((o) => {
        const avatarColor = getAvatarColor(o.name);
        const initials = getInitials(o.name);
        return (
          <div key={o.profileId} className="detail-friend-item">
            {o.avatar ? (
              <img
                src={o.avatar}
                alt={o.name}
                width={28}
                height={28}
                loading="lazy"
                decoding="async"
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  objectFit: 'cover', flexShrink: 0,
                }}
                title={o.name + ' (' + o.priority + ')'}
              />
            ) : (
              <div
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: avatarColor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}
                title={o.name + ' (' + o.priority + ')'}
              >
                {initials}
              </div>
            )}
            <span>{o.name}</span>
            <span className="friend-priority" style={{ color: priColors[o.priority] }}>
              {priLabels[o.priority]}
            </span>
          </div>
        );
      })}

      {crewNotes.length > 0 && (
        <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent-aqua)', marginBottom: '6px' }}>
            Crew Notes
          </div>
          {crewNotes.map((cn, i) => (
            <div key={i} style={{ fontSize: '13px', padding: '4px 0' }}>
              <strong style={{ color: 'var(--text-secondary)' }}>{cn.name + ': '}</strong>
              {cn.note}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { Profile } from '@festie/shared/types';
import Avatar from '../ui/Avatar';

interface FriendAvatarsProps {
  profiles: Profile[];
  maxVisible?: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function FriendAvatars({ profiles, maxVisible = 5, size = 'md' }: FriendAvatarsProps) {
  const visible = profiles.slice(0, maxVisible);
  const remaining = profiles.length - visible.length;
  const sizeMap = { sm: 20, md: 28, lg: 32 };
  const sizePixels = sizeMap[size];

  return (
    <div className="flex items-center gap-1">
      {visible.map((profile) => (
        <Avatar key={profile.id} name={profile.name || 'User'} size={size} />
      ))}
      {remaining > 0 && (
        <div
          className="flex items-center justify-center rounded-full bg-bg-card border border-border text-xs font-semibold text-text-secondary"
          style={{ width: sizePixels, height: sizePixels }}
          title={`${remaining} more`}
        >
          +{remaining}
        </div>
      )}
    </div>
  );
}

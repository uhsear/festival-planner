import React from 'react';
import { getAvatarColor, getInitials, normalizeIdentityName } from '@festie/shared';
import { cn } from '../../lib/utils';

interface AvatarProps {
  name?: string;
  image?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showOnline?: boolean;
  isOnline?: boolean;
  className?: string;
}

const sizeMap = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-14 h-14 text-lg',
};

const dotSizeMap = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
};

export default function Avatar({
  name = 'User',
  image,
  size = 'md',
  showOnline = false,
  isOnline = false,
  className,
}: AvatarProps) {
  const normalizedName = normalizeIdentityName(name);
  const initials = getInitials(normalizedName);
  const bgColor = getAvatarColor(normalizedName);

  return (
    <div className={cn('relative inline-flex flex-shrink-0', className)}>
      {image ? (
        <img
          src={image}
          alt={normalizedName}
          className={cn(
            'rounded-full object-cover',
            sizeMap[size]
          )}
        />
      ) : (
        <div
          style={{ backgroundColor: bgColor }}
          className={cn(
            'rounded-full flex-center font-semibold text-white',
            sizeMap[size]
          )}
        >
          {initials}
        </div>
      )}

      {showOnline && (
        <div
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-bg-primary',
            dotSizeMap[size],
            isOnline ? 'bg-accent-green' : 'bg-text-muted'
          )}
        />
      )}
    </div>
  );
}

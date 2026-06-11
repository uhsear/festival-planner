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

// Intrinsic pixel dimensions that match sizeMap's Tailwind classes. Passed
// as HTML width/height attrs on <img> so the browser reserves layout space
// before the avatar URL resolves — eliminates avatar-pop CLS in crew lists
// and member rows where 20+ avatars load in parallel.
const sizePx = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
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
          width={sizePx[size]}
          height={sizePx[size]}
          loading="lazy"
          decoding="async"
          className={cn('rounded-full object-cover', sizeMap[size])}
        />
      ) : (
        <div
          style={{ backgroundColor: bgColor }}
          className={cn('rounded-full flex-center font-semibold text-white', sizeMap[size])}
        >
          {initials}
        </div>
      )}

      {showOnline && (
        <div
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-bg-primary',
            dotSizeMap[size],
            // R6: ONLINE → aqua dot (#00e8d0); OFFLINE → muted neutral.
            // No greens — accent rule: aqua = primary/positive, green retired.
            isOnline ? 'bg-accent-aqua' : 'bg-text-muted',
          )}
        />
      )}
    </div>
  );
}

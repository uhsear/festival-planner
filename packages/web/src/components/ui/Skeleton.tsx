import { cn } from '../../lib/utils';

interface SkeletonProps {
  variant?: 'text' | 'circle' | 'card' | 'header';
  className?: string;
}

export default function Skeleton({
  variant = 'text',
  className,
}: SkeletonProps) {
  const variantStyles = {
    text: 'h-4 w-full rounded',
    circle: 'w-10 h-10 rounded-full',
    card: 'h-32 w-full rounded-lg',
    header: 'h-8 w-1/3 rounded mb-4',
  };

  return (
    <div
      className={cn(
        'skeleton',
        variantStyles[variant],
        className
      )}
      aria-busy="true"
      aria-label="Loading"
    />
  );
}

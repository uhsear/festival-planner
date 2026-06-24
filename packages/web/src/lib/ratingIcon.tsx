import { Flame, Smile, ThumbsUp, Meh, ThumbsDown, type LucideIcon } from 'lucide-react';
// Re-export shared scale data so callers can use a single import for both.
export { RATING_SCALE } from '@festie/shared/constants';

/**
 * Web-only icon map for the 5-tier rating scale. The pure data (label, order)
 * lives in @festie/shared/constants RATING_SCALE_DATA; this adds the Lucide
 * icon component references that are web-specific. Mobile uses Ionicons names
 * instead (see mobile/components/RatingButtons.tsx).
 */
export const RATING_META: Record<number, { Icon: LucideIcon; label: string }> = {
  5: { Icon: Flame, label: 'Fire' },
  4: { Icon: Smile, label: 'Good' },
  3: { Icon: ThumbsUp, label: 'Okay' },
  2: { Icon: Meh, label: 'Meh' },
  1: { Icon: ThumbsDown, label: 'Skip' },
};

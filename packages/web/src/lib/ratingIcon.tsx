import { Flame, Smile, ThumbsUp, Meh, ThumbsDown, type LucideIcon } from 'lucide-react';

/**
 * The 5-tier set-rating scale, shared across the rating UI (buttons, account
 * history, posters). Replaces the OS-font emoji (🔥😊👍🤔👎), which rendered
 * inconsistently across platforms and polluted the accessibility tree.
 */
export const RATING_META: Record<number, { Icon: LucideIcon; label: string }> = {
  5: { Icon: Flame, label: 'Fire' },
  4: { Icon: Smile, label: 'Good' },
  3: { Icon: ThumbsUp, label: 'Okay' },
  2: { Icon: Meh, label: 'Meh' },
  1: { Icon: ThumbsDown, label: 'Skip' },
};

/** High → low, for rendering the rating buttons in order. */
export const RATING_SCALE = [5, 4, 3, 2, 1] as const;

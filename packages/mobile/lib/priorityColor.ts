import type { Priority } from '@festie/shared/types';
import type { useTokens } from '../hooks/useTokens';

/** Maps a priority value to its accent token color. Single source of truth
 *  for mobile — replaces the identical copy that existed in picks.tsx,
 *  set/[setId].tsx, SetCardMobile.tsx, and TBASection.tsx. */
export function priorityColor(t: ReturnType<typeof useTokens>, p: Priority): string {
  if (p === 'must') return t.colors.priority.must;
  if (p === 'want-to-see') return t.colors.priority.want;
  return t.colors.priority.maybe;
}

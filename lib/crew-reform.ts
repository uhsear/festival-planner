// ── Crew reform roster logic (M3 "Reform crew for next festival") ──────────
//
// Crews are festival-scoped (crews.festival_id NOT NULL) — there is no
// cross-festival crew identity. "Reforming" a crew therefore means: create a
// NEW crew in the target festival and bring the prior roster across.
//
// Consent-safety is the hard rule. We do NOT silently re-add the whole roster
// into a festival they may not have joined. The split is:
//   • requester       → always added as OWNER of the new crew.
//   • prior member who ALREADY has a profile in the target festival → auto-add
//     (joining a crew requires a festival profile, enforced in POST /crews/join;
//     these members already satisfy that, so adding them is a no-consent-gap op).
//   • everyone else   → INVITED via the shared invite link + notified, never
//     silently added (they'd need a festival profile first anyway).
//
// This module is pure decision logic over already-fetched data so it can be
// unit-tested with a mock pool / plain arrays. The route (routes/crews.ts) does
// the IO (read members, check profiles, create crew, add members) around it.

export interface ReformMemberInput {
  /** Source-crew member's user id. */
  userId: string;
  /** Source-crew role ('owner' | 'member'); informational only. */
  role?: string;
}

export interface ReformRosterPlan {
  /** Members to auto-add to the new crew (already have a target-festival profile). */
  toAutoAdd: string[];
  /** Members to invite + notify instead (no target-festival profile yet). */
  toInvite: string[];
}

/**
 * Split a source crew's roster into auto-add vs invite for the new crew.
 *
 * @param sourceMembers     Members of the SOURCE crew (prior roster).
 * @param requesterUserId   The user reforming the crew — becomes owner, excluded
 *                          from both lists (they're added as owner separately).
 * @param targetProfileUserIds  User ids that ALREADY have a profile in the
 *                          target festival (from profiles.userIdsByFestival).
 * @param existingMemberUserIds User ids ALREADY in the new crew — for
 *                          idempotency, so re-running reform never double-adds.
 *                          Empty on first run.
 *
 * Pure + deterministic. De-dups, preserves source order, and is idempotent:
 * passing the new crew's current members as `existingMemberUserIds` yields an
 * empty `toAutoAdd` on a second run.
 */
export function planReformRoster(
  sourceMembers: ReformMemberInput[],
  requesterUserId: string,
  targetProfileUserIds: Iterable<string>,
  existingMemberUserIds: Iterable<string> = [],
): ReformRosterPlan {
  const hasProfile = new Set(targetProfileUserIds);
  const alreadyMember = new Set(existingMemberUserIds);

  const toAutoAdd: string[] = [];
  const toInvite: string[] = [];
  const seen = new Set<string>();

  for (const m of sourceMembers) {
    const uid = m?.userId;
    if (!uid) continue;
    // The requester is the owner of the new crew — never in either list.
    if (uid === requesterUserId) continue;
    // De-dup a roster that somehow lists the same user twice.
    if (seen.has(uid)) continue;
    seen.add(uid);
    // Idempotency: skip anyone already on the new crew.
    if (alreadyMember.has(uid)) continue;

    if (hasProfile.has(uid)) {
      toAutoAdd.push(uid);
    } else {
      toInvite.push(uid);
    }
  }

  return { toAutoAdd, toInvite };
}

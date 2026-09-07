/**
 * Pure phrasing helpers for CrewSuggestionStrip. They live here rather than
 * inside the .tsx because the mobile vitest harness is node-only with no RN
 * transform (see vitest.config.ts), so this is the layer a test can exercise.
 *
 * The nudge logic itself is NOT here — it stays in @festie/shared
 * (buildCrewNudges / useCrewNudges); these only phrase what it returns.
 */

/** Count caption, web parity: "3 going — 2 must, 1 want". */
export function goingLabel(count: number, breakdown: string): string {
  return `${count} going${breakdown ? ` — ${breakdown}` : ''}`;
}

/** Add a11y label, web parity: "Add Foo to my picks — 3 crew going: 2 must, 1 want". */
export function addLabel(name: string, count: number, breakdown: string): string {
  return `Add ${name} to my picks${breakdown ? ` — ${count} crew going: ${breakdown}` : ''}`;
}

/** Avatar-cluster a11y label, web parity (CrewOverlapAvatars): "3 crew members going to Foo — 2 must, 1 want". */
export function clusterLabel(name: string, count: number, breakdown: string): string {
  return `${count} crew ${count === 1 ? 'member' : 'members'} going to ${name}${breakdown ? ` — ${breakdown}` : ''}`;
}

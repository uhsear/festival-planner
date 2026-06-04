/**
 * useListBottomInset (mobile): the single source of truth for how much bottom
 * padding a scrollable list (FlatList / ScrollView / SectionList) must reserve
 * so its LAST item clears the iPhone home indicator (and Android gesture bar).
 *
 * ── Why this exists (the iOS gap it closes) ───────────────────────────────
 * Notched iPhones (12/13/14/15/16 and the Pro/Max lines) draw a translucent
 * home indicator at the very bottom of the screen. `useSafeAreaInsets().bottom`
 * reports that gap (typically ~34px in portrait; 0 on older Touch-ID devices
 * and most Android button-nav phones).
 *
 * The TAB screens (Timeline / Picks / Crew / Account) are mostly covered here:
 * the tab bar in `app/(tabs)/_layout.tsx` already grows its height by the inset
 * and is opaque, so list content scrolls UP TO the tab bar, not under the
 * indicator. The real exposure is every NON-tab scroll surface — the stack /
 * modal routes (crew-plan, crew-compare, festival-mode, compass, map, wrap,
 * plan-share, set detail, the auth screens) plus any list whose own bottom
 * padding was hand-typed without the inset. On those, a fixed `paddingBottom`
 * leaves the last row tucked under the home indicator, where it can't be fully
 * read or tapped.
 *
 * Smoke screenshots are captured on Android (gesture/button nav, inset 0), so
 * this overlap is INVISIBLE in CI artifacts — it only appears on real notched
 * iPhones. That blind spot is exactly the audited test gap this hook codifies.
 *
 * ── The contract ──────────────────────────────────────────────────────────
 * Bottom padding = a visible base gap (token-aligned, 16–24px) + the live
 * safe-area bottom inset. This guarantees the audited rule on every device:
 *
 *     last item bottom edge ≥ 16px above the home indicator.
 *
 * Pass `base` to pick the visible cushion above the indicator (defaults to
 * spacing[6] = 24px, the comfortable end of the 16–24px range). Tab screens,
 * whose tab bar already eats the inset, pass `includeSafeArea: false` to keep
 * just the visible cushion and avoid double-padding.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   // Non-tab scroll surface (stack / modal route): add the inset.
 *   const bottomPad = useListBottomInset();
 *   <FlatList contentContainerStyle={[styles.listContent, { paddingBottom: bottomPad }]} … />
 *
 *   // Tab screen: tab bar already absorbs the inset — keep only the cushion.
 *   const bottomPad = useListBottomInset({ includeSafeArea: false });
 *
 * Returning a single number (not a style object) keeps the call site free to
 * compose it with the screen's existing token-built `contentContainerStyle`,
 * so this is purely additive — no existing style is overwritten.
 *
 * ── Per-screen QA checklist (run before any iOS / TestFlight ship) ─────────
 * On an iPhone 12 or newer (a device WITH a home indicator), for each list
 * surface below, scroll fully to the bottom and confirm the last item's bottom
 * edge sits ≥16px above the home indicator (it must be fully legible and
 * tappable — no clipping, no overlap with the indicator pill):
 *
 *   Tab screens (tab bar covers the inset — verify the cushion only):
 *     - Picks            app/(tabs)/picks.tsx       (last set card)
 *     - Account          app/(tabs)/account.tsx     (Danger / delete section)
 *     - Crew             app/(tabs)/crew.tsx        (last member row)
 *     - Timeline         app/(tabs)/index.tsx       (last set of the last day)
 *
 *   Non-tab / stack / modal surfaces (MUST include the inset):
 *     - Crew plan        app/crew-plan.tsx
 *     - Crew compare     app/crew-compare.tsx
 *     - Festival mode    app/festival-mode.tsx
 *     - Compass          app/compass.tsx
 *     - Map              app/map.tsx
 *     - Wrap             app/wrap.tsx
 *     - Plan share       app/plan-share.tsx
 *     - Set detail       app/set/[setId].tsx
 *     - Auth (login / register / forgot / reset)
 *
 * Until this is wired into automated UI tests, this checklist + hook is the
 * verifiable contract: any list using `useListBottomInset()` is provably
 * inset-correct on notched iPhones by construction.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing } from '@festie/shared/tokens';

export interface UseListBottomInsetOptions {
  /**
   * The visible cushion (in px) above the home indicator, on top of the inset.
   * Defaults to the comfortable end of the audited 16–24px range. Use
   * `spacing[4]` (16) for tighter lists.
   */
  base?: number;
  /**
   * Whether to add the live safe-area bottom inset. Defaults to `true`.
   * Set `false` on tab screens whose tab bar already absorbs the inset, so the
   * last row isn't double-padded.
   */
  includeSafeArea?: boolean;
}

/**
 * Returns the bottom padding (px) a scrollable list should apply so its last
 * item clears the home indicator by the audited ≥16px margin. See the module
 * doc block for the contract and the per-screen QA checklist.
 */
export function useListBottomInset(options: UseListBottomInsetOptions = {}): number {
  const { base = spacing[6], includeSafeArea = true } = options;
  const insets = useSafeAreaInsets();
  return includeSafeArea ? base + insets.bottom : base;
}

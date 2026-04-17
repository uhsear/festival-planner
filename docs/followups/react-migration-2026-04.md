# React Migration Followups — 2026-04

Single source of truth for deferred work after the React 19 migration (live 2026-04-16) and Mobile Design Critique Loop (2026-04-17). Organized by severity × area.

## HIGH — worth next sprint

### Accessibility
- **Timeline-pick-btn 36×36 at 320px viewport.** Accepted per WCAG 2.2 AA (24×24 threshold met) but AAA wants 44×44. Fix requires timeline cell layout redesign so a 44×44 target fits in a ~60px-wide time cell without crushing artist-name text. Source: `public/app.css` R22 block, media query `@media (min-width: 380px)` upgrades to 44.
- **Admin mobile tab contrast at 430×932 portrait (iPhone 14 Pro Max).** Single-cell axe flag. `.px-3.py-1.5.rounded-md` `text-text-secondary` (#9999bb) on admin glass bg computes marginally under 4.5:1 in this specific context. Fix: bump inactive tab to `text-primary` or darken the glass bg at this breakpoint.
- **Install App button verification.** `beforeinstallprompt` is captured (Header.tsx) but we haven't confirmed an install actually fires on a real installable browser. Test from Chrome on Android/desktop.

### UX / Admin panel
- **AdminCrews expanded view shows only IDs.** Need a separate members fetch on expand — `/crews/:id/members` or read from crew detail endpoint. Currently lists `festivalId` and `crewId` only.
- **AdminFestivals > 300 lines.** Split into `FestivalEditForm.tsx`, `DayEditor.tsx`, `SetEditor.tsx` for maintainability.
- **Admin nav inversion on mobile.** `.admin-mobile-only` and `.admin-desktop-sidebar` use media query at 768px. Devices in 430-768px band (some tablets, iPhone 14 Pro Max landscape) get mobile tabs. Consider a 430px or container-query breakpoint.

## MEDIUM — tech debt, nice-to-have

### Type safety
- **`uiStore` dead fields.** `canInstall`, `installPromptEvent`, `appInstalled`, `serviceWorkerReady`, `detailSetTrigger` have setters but no readers. Safe to remove.
- **`useOfflineSnapshot` validation.** Rejects snapshots missing `user` or `festival`, but those fields aren't in the `OfflineSnapshot` type — always fails hydration. Either add fields to type or loosen validation to `snapshot.timestamp` check.
- **`usePicks` unused etag/updatedAt.** `SavePickRequest` carries `updatedAt` and `etag` but `festivalStore.savePick` ignores them. Either wire optimistic-locking (`If-Match` header) or remove from the request type.
- **Window globals typed as `any`.** `api.ts:33,35,47` and `socket.ts:30` cast `window` to `any`. Add a typed extension:
  ```typescript
  declare global { interface Window { __FP_BEARER_TOKEN?: string; __FP_API_BASE?: string; __festieInstallPrompt?: any; } }
  ```

### Error handling
- **`usePushNotifications` silent failures.** `.catch(console.error)` on `registerToken()` — no UI signal. Add `permissionState` return + toast on failure.
- **`authStore.uploadAvatar` optimistic state.** Updates `user.avatar` before verifying upload — stale URL if upload fails after optimistic state set. Only update on success, or add rollback on error.
- **`useOfflineQueue` IDB transaction leak.** `txStore()` can leave transactions open on rejected promise. Wrap in try/finally; explicitly abort on error.

### Performance
- **Tailwind `cn()` doesn't dedupe.** `lib/utils.ts` uses plain string join. When conflicting utilities pass together (e.g., `w-full` + `w-32`), behavior depends on CSS order. Install `tailwind-merge` + `clsx` (not currently in `package.json`):
  ```bash
  pnpm -F @festie/web add tailwind-merge clsx
  ```
  Then `twMerge(clsx(inputs))` in cn().
- **Real User Monitoring.** We only measure synthetic FCP (32-120ms). Set up Lighthouse CI or web-vitals beacon for LCP/CLS/INP.
- **Timeline memo deps.** Some `useMemo` in `timeline.tsx` include store selectors directly. Consider extracting stable subscribers.
- **AdminAnalytics `data.picks.must` style guard.** We null-safed critical paths but each `data.X.Y` read still carries risk if backend shape drifts. Consider zod runtime validation on `/admin/analytics` response.

### Realtime
- **`useRealtimeSync` invalidates TanStack Query AND Zustand.** Works but double-fetches when both paths trigger. Pick one source of truth per event or debounce.
- **`useSocket` festivalId capture.** `leave-festival` emit on cleanup uses captured `joinedFestivalId`. Verify stale-closure behavior on rapid festival switches.

### UI polish
- **Purple stage palette brightness.** `#6a1b9a` (Mystic Garden) fails contrast on dark bg. R26 sidesteps with solid bg + white text on `.pick-stage`, but the raw color is used elsewhere (`.card-stage`, stage headers). Consider lightening the base or adding a `--stage-purple-accessible` variant.
- **`.stage-chip` + `.pick-stage` duplication.** Same inline-style pattern in two React spots (AppShell, picks.tsx, timeline.tsx TBA). Extract to a `<StageBadge>` component.
- **Spotify preview button click.** `.card-preview-btn` onClick is a no-op `e.stopPropagation()`. Need to call `/spotify/preview/:setId` and play inline.
- **Detail panel Spotify embed.** Lazy-loads iframe via button click. Verify no CLS when embed mounts.
- **Crew settings button.** `crew.tsx` has a "Crew Settings" button with no handler. Either wire up or remove.
- **UserMenu change-email + change-password modals.** Marked TODO in `UserMenu.tsx:282, 301`. Both close menu but don't open a modal.
- **OfflineBanner session persistence.** R25 added sessionStorage but the "X" dismiss doesn't re-animate on next offline episode — it just hides. OK per spec.

## LOW — nits, backlog

### Accessibility
- **ConflictCompare close button** missing `aria-label` (icon-only `X`).
- **FestivalModeToggle** missing `aria-label` when text hides on mobile (`hidden sm:inline`).
- **ScheduleExport error UI.** PDF/ICS/CSV exports only `console.error` on failure — no toast or retry UI.

### Consistency
- **Avatar color helpers duplicated.** `UserMenu.tsx:18-27` defines `getAvatarColor` + `getInitials` locally; also in `@festie/shared/utils/colors.ts`. Import from shared.
- **useServiceWorker unused.** Defined but never imported. Safe to remove (Vite-PWA handles registration via `virtual:pwa-register`).
- **Socket error `any` type.** `useSocket.ts:54` — `socket.on('error', (error: any))`. Type as `SocketException` or generic `Error`.
- **AdminUsers date format.** `toLocaleDateString()` uses browser locale — admin reports may prefer ISO.

### Dead code / cleanup
- **DayTabs.tsx is unused** (earlier agent flagged). Day tabs moved to AppShell sub-header. Safe to delete file.
- **Mobile package stub.** `packages/mobile/` has minimal content. Decide: continue React Native plan or remove.
- **`lib/utils.ts` `cn()` + `tailwind-merge`** — covered above under MEDIUM.

## Accepted debt (will not fix unless user impact surfaces)

- **Nested-interactive on `.card-enter` outer wrapper** (pre-existing legacy pattern). R25 fixed `.set-card` and `.timeline-tba-card` via positioned click-overlay. Any remaining nested-interactive axe flags are from the `.card-enter` wrapper receiving animation classes — not a real interactive nesting.
- **Legacy `public/app.css` size.** 4500+ lines across R1-R26. Consolidation/dedup is a multi-day refactor; on the todo only if CSS perf becomes a bottleneck.
- **Register without email.** Intentional — users can register with username only. Email is optional for password reset.
- **PWA `skipWaiting` + `clientsClaim`.** Forces page reload when new SW activates. Users may lose form input on update. Accepted trade-off for keeping users on latest version.

## How to use this doc

1. Next session, read this file first to see what's on deck
2. Group related items (e.g., "Tailwind cleanup": cn+twMerge, dead DayTabs, admin size) into sprints
3. After fixing, remove the line item (or move to "Accepted debt" if scope changes)
4. Add new items discovered mid-session at the top of the appropriate severity section

## References

- Mobile Design Critique FINAL: `docs/session-logs/mobile-loop-2026-04-17/FINAL.md`
- React migration spec: `docs/plans/react-migration-spec-2026-04-16.md`
- Memory: `memory/project_react_rewrite_live.md`, `memory/feedback_parallel_agents.md`
- Session logs: `docs/session-logs/mobile-loop-2026-04-17/pass{1..8}/findings.json`

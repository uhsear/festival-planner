# Data Flow: Zustand vs react-query vs Socket.IO

This document defines the boundary between the three state/data layers in the
Festie frontend. Follow these rules when adding new features.

## Zustand -- client-side state

Owns state that is **local to the browser session** and has no server-side
source of truth, or state that needs to be **synchronously readable** outside
of React (e.g. in Socket.IO event handlers).

| Store | Purpose |
|-------|---------|
| `festivalDataStore` | Cached server data (festivals, sets, stages, days, profiles) + loading/error flags. Populated by API calls and Socket.IO pushes. Persists `currentFestivalId` to localStorage. |
| `festivalUIStore` | Pure UI state (selectedDay, activeStages, searchQuery). No network calls. |
| `authStore` | Session token, current user, login/logout. |
| `crewStore` | Active crew, members, overlap map. |
| `uiStore` | Detail panel selection, connection status, offline mode, pending sync count, online users. |
| `festivalModeStore` | Festival-mode toggle, auto-scroll, past-sets visibility. |

**When to use Zustand:**
- UI-only state (filters, selections, toggles)
- Auth/session state (token, user object)
- State that Socket.IO event handlers push into (needs `getState()` outside React)
- Offline queue / sync tracking
- Any state that must survive a react-query cache clear

## @tanstack/react-query -- server cache

Owns **server data that benefits from automatic cache invalidation, refetch on
focus, and stale-while-revalidate**. Currently used for:

- One-off data fetches that don't need real-time updates
- Data that benefits from background refetching (e.g. festival list on tab focus)

**When to use react-query:**
- Read-only server data with no real-time requirement
- Data that should auto-refetch on window focus or reconnect
- Paginated / infinite lists
- Mutations with optimistic updates where cache rollback is valuable

**When NOT to use react-query:**
- State that Socket.IO already pushes in real time (would fight with the cache)
- Pure client state (use Zustand)
- State read by Socket.IO handlers (they run outside React; use `store.getState()`)

## Socket.IO -- real-time updates

Pushes server events **into Zustand stores**. The socket service subscribes to
events and calls `store.setState()` or store actions directly.

| Event | Target store |
|-------|-------------|
| `profile:updated` | `festivalDataStore` (reloads profiles) |
| `festival:updated` | `festivalDataStore` (reloads festival detail) |
| `crew:*` | `crewStore` |
| `presence:*` | `uiStore` (onlineUsers) |
| `chat:*` | `crewStore` (crew activity) |

**Rule:** Socket.IO listeners must never call react-query's `queryClient`
directly. They push into Zustand; components that need both can compose
selectors from both sources.

## Decision flowchart

```
Is it pure UI state (no server round-trip)?
  YES -> Zustand (festivalUIStore, uiStore, etc.)
  NO  -> Does Socket.IO push updates for it?
           YES -> Zustand (so event handlers can write via getState())
           NO  -> Does it benefit from stale-while-revalidate / auto-refetch?
                    YES -> react-query
                    NO  -> Zustand (simple fetch-and-store)
```

# Festie — Socket.IO Contract v1

## Connection

```
wss://festie.us/socket.io/?token=<session_token>&EIO=4&transport=websocket
```

**Authentication options (pick one):**
- Query param: `?token=<session_token>` (recommended for mobile)
- Authorization header: `Bearer <session_token>` (handshake headers)
- Cookie: `festival_user_session=<session_token>` (browser only)

**Connection is accepted if:**
- Rate limit not exceeded (30 connections/min per IP)
- Valid Origin header (browser) OR valid token/Bearer auth (mobile)

**Auth is validated on `join:festival`, not on connection.** A connected socket with no valid session will be disconnected on its first join attempt.

## Client → Server Events

### `join:festival`
Join a festival room for real-time updates.

```json
// Emit
socket.emit("join:festival", "<festivalId>", { "userToken": "<optional_token>" })
```

- `festivalId` (string, required): Festival ID to join
- `userToken` (string, optional): Session token. Required if not using query param or cookie auth.
- **Rate limit:** 12/10sec per userId
- **Validation:** Festival must exist, session must be valid, user must have a profile in the festival
- **Behavior:** Leaves any previously joined festival room, joins new room, emits `presence:update`
- **On failure:** Socket is disconnected (invalid session) or receives `error` event

### `leave:festival`
Leave the current festival room.

```json
socket.emit("leave:festival")
```

- No payload
- **Rate limit:** 20/10sec per userId
- **Behavior:** Leaves current room, emits `presence:update` to room

### `join:crew`
Join a crew room for real-time crew updates.

```json
socket.emit("join:crew", { "crewId": "<crewId>" }, ack)
```

- `crewId` (string, required): Crew ID to join
- **Rate limit:** 12/10sec per userId (shared with `join:festival`)
- **Validation:** Session must be valid, user must be a member of the crew
- **On success:** `ack({ ok: true, crewId })`

### `leave:crew`
Leave a crew room.

```json
socket.emit("leave:crew", { "crewId": "<crewId>" })
```

- `crewId` (string, required): Crew ID to leave
- **Rate limit:** 20/10sec per userId
- No ack callback

### `reconnect:restore`
Restore presence state after reconnection.

```json
socket.emit("reconnect:restore", { "festivalId": "<festivalId>", "userToken": "<optional>" }, ack)
```

- Re-validates session and rejoins the festival room
- **Behavior:** Same as `join:festival` but intended for reconnection flows

## Server → Client Events

### `presence:update`
Online users in the festival room changed.

```json
{
  "online": [
    { "userId": "user-abc123", "username": "alice", "avatarUrl": "/uploads/avatars/abc.webp?v=xyz" }
  ]
}
```

- Debounced 200ms to batch rapid join/leave events

### `profile:created`
A user joined the festival.

```json
{
  "festivalId": "fest-abc",
  "profile": {
    "id": "prof-abc",
    "name": "alice",
    "avatarUrl": "/uploads/avatars/abc.webp?v=xyz",
    "liveStatus": null
  }
}
```

### `profile:updated`
A user updated their picks or live status.

```json
{
  "festivalId": "fest-abc",
  "profileId": "prof-abc",
  "name": "alice",
  "avatarUrl": "/uploads/avatars/abc.webp?v=xyz",
  "picks": { "set-1": "must", "set-2": "maybe" },
  "liveStatus": { "preset": "at-stage", "stageId": "stage-1", "text": "", "updatedAt": "..." }
}
```

### `profile:deleted`
Admin removed a profile from the festival.

```json
{ "festivalId": "fest-abc", "profileId": "prof-abc" }
```

### `profile:identity`
User changed their avatar or username.

```json
{
  "festivalId": "fest-abc",
  "profileId": "prof-abc",
  "username": "alice",
  "avatarUrl": "/uploads/avatars/abc.webp?v=xyz"
}
```

### `festival:created`
```json
{ "id": "fest-abc", "name": "Electric Forest 2026" }
```

### `festival:updated`
```json
{ "id": "fest-abc" }
```

### `festival:deleted`
```json
{ "id": "fest-abc" }
```

### `festival:access-revoked`
Admin removed the user from the festival, or the festival was deleted.

```json
{ "festivalId": "fest-abc", "profileId": "prof-abc" }
```

### `error`
```json
{ "message": "Rate limit exceeded" }
```

## Reconnection

- Mobile clients should use exponential backoff with jitter
- After reconnect, re-emit `join:festival` — socket state is lost on disconnect
- Session token must be re-validated on each `join:festival`

## Mobile Client Libraries

| Platform | Package | Status |
|----------|---------|--------|
| iOS (Swift) | `socket.io-client-swift` | Stable, supports v4 protocol |
| Android (Kotlin) | `socket.io-client-java` | Stable, supports v4 protocol |
| React Native | `socket.io-client` (npm) | Stable, same as web |
| Capacitor | `socket.io-client` (npm, runs in WebView) | Stable |

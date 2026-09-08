# Festie — Socket.IO Contract v1

## Connection

```
wss://festie.us/socket.io/?token=<session_token>&EIO=4&transport=websocket
```

**Authentication options (pick one):**
- Handshake auth: `auth: { token: "<session_token>" }` (checked first)
- Query param: `?token=<session_token>` (recommended for mobile)
- Authorization header: `Bearer <session_token>` (handshake headers)
- Cookie: `festie_session=<session_token>` (browser only)

**Connection is accepted if:**
- Rate limit not exceeded (300 connections per 60 seconds per IP; `SOCKET_CONNECT_RATE_LIMIT` over `SOCKET_CONNECT_WINDOW`, both env-configurable)
- Valid Origin header (browser) OR valid token/Bearer auth (mobile)

**Transport is `websocket` only.** HTTP long-polling is disabled, so a client that cannot open a WebSocket cannot connect.

**Token auth is checked at the handshake; cookie and Origin connections are authenticated on the first join.** A query token or `Bearer` header that matches `/^[a-f0-9]{32,128}$/i` must also resolve to a live session, or the server rejects the handshake with `Invalid session token`. A token that fails that pattern is not rejected there: the handshake falls through to the Origin check, so it is accepted when the Origin is allowed and rejected with `Origin not allowed` when it is not. If the session lookup itself throws, the server logs the error and lets the connection through to the post-connection check. Most inbound events re-validate the session token, which must be exactly 64 characters; an invalid session disconnects the socket. `leave:festival`, `location:update`, `location:stop` and `disconnect` do not re-validate it. They trust the state the last successful join or share stamped on the socket.

**A socket must join a festival room within 5 seconds.** The server disconnects any socket that has not completed `join:festival` before the auth timeout expires, even if it never attempted a join.

## Client → Server Events

### `join:festival`
Join a festival room for real-time updates.

```json
// Emit
socket.emit("join:festival", "<festivalId>", { "userToken": "<optional_token>" })
```

- `festivalId` (string, required): Festival ID to join. It is the first positional argument, not a key in the data object.
- `userToken` (string, optional): Session token. Required if not using query param or cookie auth.
- `_v` (number, optional): Event version. Defaults to `1`.
- **Rate limit:** 12/10sec per userId, counted in its own bucket (`join:<userId>`)
- **Validation:** Session must be valid, then rate limit, then server capacity, then festival must exist, then user must have a profile in the festival
- **Room:** the raw `festivalId`, with no prefix
- **Behavior:** Leaves only the previous festival room, so the `crew:<crewId>` room survives, joins the new room, emits `presence:update`
- **On success:** `ack({ ok: true, profileId })`
- **On failure:** `ack({ ok: false, error, code })`. `error` is one of `SCHEMA_MISMATCH` (sent with `requiredVersion: 1`), `Authentication required` (also disconnects the socket), `Rate limited`, `Server is at capacity` (heap above 75% of `MAX_HEAP_BYTES`), `Room is full` (with `code: "WS_ROOM_FULL"`, at `ROOM_CAPACITY_LIMIT` sockets, default 200), `Festival not found`, `Not a member of this festival`, or `Server error`. An `error` event is emitted only for the rate-limit case and for `Not a member of this festival`.
- **Ack timeout:** 5000ms, after which the server sends `ack({ ok: false, error: "Server timeout", code: "WS_ACK_TIMEOUT" })`

### `leave:festival`
Leave the current festival room.

```json
socket.emit("leave:festival")
```

- No payload
- No ack callback
- **Rate limit:** 20/10sec per userId, keyed `leave:<userId>` — or `leave:<socketId>` when the socket has no userId
- **Behavior:** Leaves every room except the socket's own id room, so the `crew:<crewId>` room is dropped too, then emits `presence:update` to the festival room
- **On failure:** Emits `error` with `Realtime rate limit exceeded` when rate limited, or `Failed to leave festival` on an internal error

### `join:crew`
Join a crew room for real-time crew updates.

```json
socket.emit("join:crew", { "crewId": "<crewId>" }, ack)
```

- `crewId` (string, required): Crew ID to join
- `_v` (number, optional): Event version. Defaults to `1`.
- **Rate limit:** 12/10sec per userId, counted in its own bucket (`crew-join:<userId>`), separate from `join:festival`
- **Validation:** Session must be valid, crew must exist, user must be a member of the crew
- **Room:** `crew:<crewId>`
- **Behavior:** Leaves the previous `crew:<crewId>` room, then joins the new one
- **On success:** `ack({ ok: true, crewId })`
- **On failure:** `ack({ ok: false, error })` where `error` is `SCHEMA_MISMATCH`, `Authentication required` (also disconnects the socket), `Rate limited`, `Crew not found`, `Not a member of this crew`, or `Server error`
- **Ack timeout:** 5000ms, after which the server sends `ack({ ok: false, error: "Server timeout", code: "WS_ACK_TIMEOUT" })`

### `leave:crew`
Leave a crew room.

```json
socket.emit("leave:crew", { "crewId": "<crewId>" })
```

- `crewId` (string, required): Crew ID to leave
- `_v` (number, optional): Event version. Defaults to `1`.
- **Rate limit:** 20/10sec per userId, counted in its own bucket (`crew-leave:<userId>`), separate from `leave:festival`
- **Behavior:** Leaves room `crew:<crewId>`. If this socket was sharing live location to that crew, the server first broadcasts `location:peer-stopped` with `reason: "left"`, clears the sharing registration, and drops the cached position.
- No ack callback
- **On failure:** An invalid session disconnects the socket. A schema mismatch or a rate-limit rejection returns silently.

### `reconnect:restore`
Restore presence state after reconnection.

```json
socket.emit("reconnect:restore", { "festivalId": "<festivalId>", "userToken": "<optional>" }, ack)
```

- `festivalId` (string, required): Festival ID to rejoin. Here it is a key in the data object, unlike `join:festival`.
- `userToken` (string, optional): Session token
- `_v` (number, optional): Event version. Defaults to `1`.
- `lastMessageSequence`: accepted and ignored. The server reads the key but the schema strips it, so it produces neither a gap-fill nor an error.
- Re-validates session and rejoins the festival room
- **Rate limit:** 12/10sec per userId, counted in its own bucket (`restore:<userId>`)
- **Behavior:** Same as `join:festival` but intended for reconnection flows
- **On success:** `ack({ ok: true, profileId })`
- **On failure:** `ack({ ok: false, error, code })` with the same values as `join:festival`

### `location:share`
Start sharing live GPS with the crew. Positions are ephemeral: they travel only over Socket.IO to the crew room and are never written to Postgres.

```json
socket.emit("location:share", {
  "crewId": "<crewId>",
  "position": {
    "lat": 42.5,
    "lng": -85.8,
    "accuracy": 12,
    "heading": 180,
    "battery": 64,
    "lowPower": false,
    "capturedAt": "..."
  },
  "expiresAt": "..."
}, ack)
```

- `crewId` (string, required): Crew to share with. Must equal the crew this socket joined.
- `position` (object, optional): First fix, broadcast immediately so peers see the sharer without waiting for the next tick. The coordinates are **nested under `position` on this event only** — `location:update` sends them flat.
- `position.lat` (number, required): -90 to 90
- `position.lng` (number, required): -180 to 180
- `position.accuracy` (number, optional): meters, 0 to 100000
- `position.heading` (number, optional): degrees, 0 to 360
- `position.battery` (number, optional): sharer battery percent, 0 to 100
- `position.lowPower` (boolean, optional): sharer device is in battery-saver mode. Note the camelCase key.
- `position.capturedAt` (string, required): ISO timestamp stamped at fix time. Note the camelCase key.
- `expiresAt` (string, optional): ISO timestamp this time-boxed share auto-stops
- `_v` (number, optional): Event version. Defaults to `1`.
- **Rate limit:** at most 3 concurrently sharing sockets per user, cluster-wide, with a 5-minute TTL refreshed on each share. Fails open when Redis is unavailable.
- **Validation:** `LIVE_LOCATION_ENABLED` must be true, the socket must already be in room `crew:<crewId>`, and the server re-validates the session and crew membership
- **Room:** broadcasts `location:peer-update` to `crew:<crewId>`, excluding the sender
- **On success:** `ack({ ok: true })`
- **On failure:** `ack({ ok: false, code })`. This event reports failures under `code`, not `error`. `code` is one of `FEATURE_DISABLED`, `SCHEMA_MISMATCH`, `NOT_IN_CREW_ROOM`, `AUTH_REQUIRED` (also disconnects the socket), `NOT_A_MEMBER`, `TOO_MANY_SHARING_SOCKETS`, or `SERVER_ERROR`.
- **Ack timeout:** 5000ms, after which the server sends `ack({ ok: false, error: "Server timeout", code: "WS_ACK_TIMEOUT" })`. That timeout ack is the one failure on this event that carries `error` as well as `code`.

### `location:update`
Send one position tick while sharing.

```json
socket.emit("location:update", {
  "crewId": "<crewId>",
  "lat": 42.5,
  "lng": -85.8,
  "accuracy": 12,
  "heading": 180,
  "speed": 1.4,
  "battery": 64,
  "lowPower": false,
  "expiresAt": "...",
  "capturedAt": "..."
})
```

- `crewId` (string, required): Crew being shared with. Must equal the crew this socket is sharing to.
- `lat` (number, required): -90 to 90. The coordinates are **flat at the top level on this event**, not nested under `position`.
- `lng` (number, required): -180 to 180
- `accuracy` (number, optional): meters, 0 to 100000
- `heading` (number, optional): degrees, 0 to 360
- `speed` (number, optional): 0 to 1000. Only this event accepts `speed`.
- `battery` (number, optional): sharer battery percent, 0 to 100
- `lowPower` (boolean, optional): sharer device is in battery-saver mode. Note the camelCase key.
- `expiresAt` (string, optional): ISO timestamp this time-boxed share auto-stops
- `capturedAt` (string, required): ISO timestamp stamped at fix time. The server clamps it to `[now - 60s, now + 30s]` before relaying it.
- `_v` (number, optional): Event version. Defaults to `1`.
- No ack callback
- **Rate limit:** 12/60sec per userId, Redis-backed and cluster-wide, falling back to a per-process counter when Redis is down
- **Validation:** `LIVE_LOCATION_ENABLED` must be true and the socket must already be sharing to this crew. The server re-checks crew membership every 20 updates or every 15 seconds, whichever comes first.
- **Room:** broadcasts `location:peer-update` to `crew:<crewId>`, excluding the sender
- **On failure:** Emits an `error` event with `code` set to `SCHEMA_MISMATCH`, `NOT_SHARING`, `RATE_LIMITED`, or `NOT_A_MEMBER`. When membership is gone the server also broadcasts `location:peer-stopped` with `reason: "revoked"` and evicts the socket from the crew room. When `LIVE_LOCATION_ENABLED` is false the event is dropped silently.

### `location:stop`
Stop sharing live GPS with the crew.

```json
socket.emit("location:stop", { "crewId": "<crewId>" }, ack)
```

- `crewId` (string, required): Crew to stop sharing with
- `_v` (number, optional): Event version. Defaults to `1`.
- **Validation:** `crewId` must match either the crew this socket joined or the crew it is sharing to, so a socket that shared to one crew and later joined another can still stop the first
- **Room:** broadcasts `location:peer-stopped` with `reason: "stop"` to `crew:<crewId>`, excluding the sender
- **On success:** `ack({ ok: true })`
- **On failure:** `ack({ ok: false })`. Every failure the handler itself sends is a bare ack with no `error` and no `code`.
- **Ack timeout:** 5000ms, after which the server sends `ack({ ok: false, error: "Server timeout", code: "WS_ACK_TIMEOUT" })`. That is the only failure ack on this event that carries `error` and `code`.

### `location:sync`
Pull every crew member's last-known position at once, so a freshly-opened app does not wait for the next update tick.

```json
socket.emit("location:sync", { "crewId": "<crewId>" }, ack)
```

- `crewId` (string, required): Crew to snapshot. Must equal the crew this socket joined.
- `_v` (number, optional): Event version. Defaults to `1`.
- **Validation:** `LIVE_LOCATION_ENABLED` must be true, the socket must already be in room `crew:<crewId>`, and the server re-validates the session and crew membership
- **Behavior:** Serves last-known positions from the ephemeral Redis cache, excluding the requester. Stale entries are filtered out.
- **On success:** `ack({ ok: true, peers })` where each peer carries the `location:peer-update` payload shape
- **On failure:** `ack({ ok: false, peers: [] })`. The `peers` array is always present, so the client can render an empty map instead of an error.
- **Ack timeout:** 5000ms, after which the server sends `ack({ ok: false, error: "Server timeout", code: "WS_ACK_TIMEOUT" })`. The timeout ack carries no `peers` key, so a client that reads `peers` unguarded must handle it being absent.

### `disconnect`
Socket.IO lifecycle event. Clients do not emit it as application data; the server runs cleanup when the connection ends.

```json
socket.on("disconnect", (reason) => { /* reason is a Socket.IO string */ })
```

- `reason` (string): Socket.IO disconnect reason
- **Behavior:** If the socket was sharing live location, the server broadcasts `location:peer-stopped` with `reason: "disconnect"` to `crew:<crewId>`, clears the sharing registration, and drops the cached position. It then removes presence, clears the session, and emits `presence:update` to the festival room.

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
  "_v": 1,
  "festivalId": "fest-abc",
  "profile": {
    "id": "prof-abc",
    "name": "alice",
    "avatarUrl": "/uploads/avatars/abc.webp?v=xyz"
  }
}
```

### `profile:updated`
A user updated their picks or display details.

```json
{
  "_v": 1,
  "festivalId": "fest-abc",
  "profileId": "prof-abc",
  "name": "alice",
  "avatarUrl": "/uploads/avatars/abc.webp?v=xyz",
  "picks": { "set-1": "must", "set-2": "maybe" },
  "updatedAt": "..."
}
```

- Debounced 200ms to coalesce rapid pick changes into one broadcast

### `profile:deleted`
Admin removed a profile from the festival.

```json
// lib/emitter.ts:126 — DELETE /api/v1/profiles/:id
{ "_v": 1, "festivalId": "fest-abc", "profileId": "prof-abc" }
```

```json
// routes/admin-users.ts:326 — admin user hard-delete, one event per removed profile
{ "festivalId": "fest-abc", "profileId": "prof-abc" }
```

- The admin user-delete path sends the same two keys without `_v`

### `profile:identity`
User changed their avatar or username.

```json
{
  "festivalId": "fest-abc",
  "profileId": "prof-abc",
  "username": "alice",
  "name": "Alice",
  "avatarUrl": "/uploads/avatars/abc.webp?v=xyz"
}
```

### `festival:created`
Broadcast to every connected socket, with no room.

```json
{ "_v": 1, "id": "fest-abc", "name": "Electric Forest 2026" }
```

### `festival:updated`
Broadcast to every connected socket, with no room.

```json
{ "_v": 1, "id": "fest-abc" }
```

### `festival:deleted`
Broadcast to every connected socket, with no room.

```json
{ "_v": 1, "id": "fest-abc" }
```

### `festival:access-revoked`
Admin removed the user from the festival, or the festival was deleted. Sent to the affected sockets only, never to a room.

```json
{ "festivalId": "fest-abc", "profileId": "prof-abc" }
```

- When the whole festival was deleted the payload carries `festivalId` only, with no `profileId`

### `location:peer-update`
A crew member shared a new position. Sent to the `crew:<crewId>` room, excluding the sender.

```json
{
  "_v": 1,
  "crewId": "crew-abc",
  "userId": "user-abc123",
  "username": "alice",
  "lat": 42.5,
  "lng": -85.8,
  "accuracy": 12,
  "heading": 180,
  "speed": 1.4,
  "battery": 64,
  "lowPower": false,
  "expiresAt": "...",
  "capturedAt": "...",
  "serverAt": "..."
}
```

- Every key is camelCase, including `lowPower`, `expiresAt`, `capturedAt` and `serverAt`
- Coordinates are flat at the top level, even though `location:share` nests them under `position`
- `speed` is present only when the fix came from `location:update`. The first fix relayed by `location:share` has no `speed` key.
- `capturedAt` is the client timestamp clamped to `[serverAt - 60s, serverAt + 30s]`; `serverAt` is the server relay time
- `accuracy`, `heading`, `speed`, `battery`, `lowPower` and `expiresAt` are optional and may be absent

### `location:peer-stopped`
A crew member stopped sharing their position. Sent to the `crew:<crewId>` room, excluding the sender.

```json
{ "_v": 1, "crewId": "crew-abc", "userId": "user-abc123", "reason": "stop" }
```

- `reason` is one of `left` (the sharer sent `leave:crew`), `revoked` (the sharer is no longer a crew member), `stop` (the sharer sent `location:stop`) or `disconnect` (the socket dropped)

### `sos:raised`
A crew member raised an SOS. Sent to the whole `crew:<crewId>` room, including the raiser.

```json
{
  "_v": 1,
  "crewId": "crew-abc",
  "userId": "user-abc123",
  "username": "alice",
  "message": "lost my phone charger, north gate",
  "position": { "lat": 42.5001, "lng": -85.8002, "accuracy": 12, "capturedAt": "..." },
  "activityId": "act-abc",
  "raisedAt": "..."
}
```

- Raised over HTTP `POST /:crewId/sos`. Clients never emit this event.
- `message` is sanitized and capped at 280 characters. It is absent when the raiser sent none.
- `position` is absent when the raiser sent none. `lat` and `lng` are rounded to 4 decimals (about 11m).
- `activityId` falls back to an empty string when the activity row could not be written
- **Rate limit:** 1 SOS per 120 seconds per userId, on top of a coarser HTTP limit of 10 per window

### `sos:cleared`
A crew member cleared the active SOS. Sent to the whole `crew:<crewId>` room.

```json
{
  "_v": 1,
  "crewId": "crew-abc",
  "userId": "user-abc123",
  "clearedBy": "alice",
  "activityId": "act-abc",
  "clearedAt": "..."
}
```

- Raised over HTTP `POST /:crewId/sos/clear`. Clients never emit this event.
- `clearedBy` is the username; `userId` is that same user's ID
- `activityId` is omitted when the activity row could not be written, unlike `sos:raised` which sends an empty string

#### Crew events

Every event below is sent to the `crew:<crewId>` room and reaches the acting member's own socket, unless the entry says otherwise. Of the crew events, only the three produced through `lib/emitter.ts` — `crew:expense-added`, `crew:expense-deleted` and `crew:activity` — carry `_v`. The crew CRUD events, which each route file emits directly, carry none. See "The `_v` field" for the rule across the whole contract.

### `crew:updated`
Crew details or the member list changed. Sent to the whole `crew:<crewId>` room. Two producers send the same shape: `PUT /api/v1/crews/:crewId` (routes/crews.ts:601) and `PUT /api/v1/crews/:crewId/transfer` (routes/crew-members.ts:259).

```json
{
  "id": "crew-abc",
  "festivalId": "fest-abc",
  "name": "Forest Fam",
  "owner": "user-abc123",
  "createdBy": "user-abc123",
  "maxMembers": 12,
  "reformedFrom": null,
  "createdAt": "...",
  "updatedAt": "...",
  "homeBaseLocation": "Camp 42",
  "homeBaseTime": "18:00",
  "homeBaseUpdatedAt": "...",
  "photoAlbumUrl": null,
  "totem_name": "Big Banana",
  "totem_emoji": "🍌",
  "members": [
    {
      "userId": "user-abc123",
      "username": "alice",
      "name": "alice",
      "avatarKey": null,
      "avatarVersion": null,
      "role": "owner",
      "joinedAt": "..."
    }
  ],
  "memberCount": 1
}
```

- The payload is the serialized crew itself, with no wrapper key
- `totem_name` and `totem_emoji` are snake_case inside an otherwise camelCase object
- `inviteCode`, `inviteExpiresAt`, `role` and `joinedAt` are never broadcast. The serializer runs with no requesting user, and the route deletes `inviteCode` as well.
- On the transfer path the crew row is the pre-transfer read, so `updatedAt` predates the role swap while `members` already carries the new roles
- **Rate limit:** 10 per 60s per userId on the edit path (`crew-update`), 5 per 60s per userId on the transfer path (`crew-transfer`)

### `crew:deleted`
The crew is gone. Sent to the whole `crew:<crewId>` room before the sockets are evicted, so every member still receives it. All three producers send the same shape.

```json
// routes/crews.ts:628 — DELETE /api/v1/crews/:crewId (owner)
// routes/admin-bulk.ts:80 — DELETE /api/v1/admin/crews/:id and POST /api/v1/admin/bulk/archive-festivals
// routes/festivals.ts:64 — DELETE /api/v1/festivals/:id
{ "crewId": "crew-abc", "festivalId": "fest-abc" }
```

- `festivalId` is declared optional in `CrewDeletedPayload`, so a client must still tolerate its absence from an older server
- routes/festivals.ts:64 fans the event out once per crew under the deleted festival
- **Rate limit:** 5 per 60s per userId on `DELETE /api/v1/crews/:crewId` (`crew-delete`) and on `DELETE /api/v1/festivals/:id` (`festival-delete`); 30 per 60s per admin on `DELETE /api/v1/admin/crews/:id` and `POST /api/v1/admin/bulk/archive-festivals` (`admin-write`, `ADMIN_WRITE_RATE_LIMIT_MAX`)

### `crew:reformed`
A crew was rebuilt for another festival from an earlier crew. Sent to the **new** crew's room, `crew:<newCrewId>`, so only clients already in that room receive it.

```json
{ "crewId": "crew-new", "reformedFrom": "crew-old", "festivalId": "fest-2027" }
```

- Raised over HTTP `POST /api/v1/crews/:crewId/reform`, where `:crewId` is the source crew
- **Rate limit:** 10 per 60s per userId (`crew-reform`)

### `crew:member-joined`
Someone joined the crew. Sent to the whole `crew:<crewId>` room. Two producers send the same shape: `POST /api/v1/crews/join` (routes/crew-invites.ts:109) and `POST /api/v1/crews/:crewId/members` (routes/crew-members.ts:365).

```json
{ "crewId": "crew-abc", "userId": "user-abc123", "username": "alice" }
```

- **Rate limit:** 10 per 60s per userId on the invite path (`crew-join`) and on the add-member path (`crew-add-member`)

### `crew:member-left`
A member left the crew. Sent to the whole `crew:<crewId>` room before the leaver is evicted, so the leaver receives it too.

```json
{ "crewId": "crew-abc", "userId": "user-abc123", "username": "alice" }
```

- Raised over HTTP `DELETE /api/v1/crews/:crewId/leave`
- An owner cannot leave before transferring ownership, so this never fires for an owner
- **Rate limit:** 10 per 60s per userId (`crew-leave`)

### `crew:member-kicked`
A member was removed by the owner or by an admin. Sent to the whole `crew:<crewId>` room before the member is evicted, so the removed member receives it too. Two producers send the same shape: routes/crew-members.ts:205 and routes/admin-bulk.ts:293.

```json
{ "crewId": "crew-abc", "userId": "user-abc123" }
```

- There is no `username` here, unlike `crew:member-joined` and `crew:member-left`. A client that renders the removal needs the roster it already holds.
- **Rate limit:** 10 per 60s per userId on `DELETE /api/v1/crews/:crewId/members/:userId` (`crew-kick`); 30 per 60s per admin on `DELETE /api/v1/admin/crews/:id/members/:userId` (`admin-write`)

### `crew:access-revoked`
The recipient lost access to the crew. **Not a room broadcast:** the server sends it to each socket of the removed user only, then drops those sockets out of the room. Two producers send the same shape: routes/crew-members.ts:78 and routes/admin-bulk.ts:51.

```json
{ "crewId": "crew-abc" }
```

- A user with several open sockets receives one copy per socket
- The socket lookup on the leave and kick paths is bounded by a 3-second timeout. If it expires, the database removal still stands but this event is never sent, so clients must also treat `crew:member-kicked` and a failed refetch as loss of access.
- **Rate limit:** inherited from the calling route — 10 per 60s per userId (`crew-leave`, `crew-kick`), or 30 per 60s per admin (`admin-write`)

### `crew:home-base-updated`
The owner set the crew's home base. Sent to the whole `crew:<crewId>` room.

```json
{ "crewId": "crew-abc", "location": "Camp 42, row H", "time": "18:00" }
```

- Raised over HTTP `PUT /api/v1/crews/:crewId/home-base`, owner only
- `location` and `time` come from the request body, not from the stored row, so the stored `home_base_updated_at` is not broadcast
- **Rate limit:** 10 per 60s per userId (`crew-homebase`)

### `crew:photo-album-updated`
A member changed the shared-album link. Sent to the whole `crew:<crewId>` room.

```json
{ "crewId": "crew-abc", "photoAlbumUrl": "https://photos.example/abc" }
```

- Raised over HTTP `PUT /api/v1/crews/:crewId/photo-album`. Any member may change it, not only the owner.
- `photoAlbumUrl` is `null` when the link was cleared
- **Rate limit:** 10 per 60s per userId (`crew-photo-album`)

### `crew:meeting-point-created`
A member added a meeting point. Sent to the whole `crew:<crewId>` room.

```json
{
  "id": "mp-abc",
  "crew_id": "crew-abc",
  "created_by": "user-abc123",
  "label": "Main gate",
  "location": "North entrance, by the flag",
  "type": "during",
  "meet_at": "...",
  "stage_reference": null,
  "expires_at": "...",
  "latitude": 42.5,
  "longitude": -85.8,
  "recurs_daily": false,
  "active": true,
  "created_at": "...",
  "updated_at": "...",
  "crewId": "crew-abc"
}
```

- The payload is the stored row itself, with no wrapper key. **Every row key is snake_case**, including `crew_id`. The same row shape is what `GET /api/v1/crews/:crewId/meeting-points` returns, and both clients render it.
- `creator_name` is not present. Only the list endpoint joins it.
- Raised over HTTP `POST /api/v1/crews/:crewId/meeting-points`
- **Rate limit:** 20 per 60s per userId (`crew-mp-create`)

### `crew:meeting-point-updated`
A meeting point changed. Sent to the whole `crew:<crewId>` room.

```json
{
  "id": "mp-abc",
  "crew_id": "crew-abc",
  "created_by": "user-abc123",
  "label": "Main gate",
  "location": "North entrance, by the flag",
  "type": "during",
  "meet_at": "...",
  "stage_reference": null,
  "expires_at": "...",
  "latitude": 42.5,
  "longitude": -85.8,
  "recurs_daily": false,
  "active": true,
  "created_at": "...",
  "updated_at": "...",
  "crewId": "crew-abc"
}
```

- The payload is the stored row itself, with no wrapper key, exactly as `crew:meeting-point-created` sends it — all snake_case row keys.
- Raised over HTTP `PUT /api/v1/crews/:crewId/meeting-points/:mpId`. Only the creator or the crew owner may edit.
- The route recomputes `expires_at` from the merged `meet_at` and `recurs_daily`, so `expires_at` can change even when the client did not send it
- **Rate limit:** 20 per 60s per userId (`crew-mp-update`)

### `crew:meeting-point-removed`
A meeting point was removed. Sent to the whole `crew:<crewId>` room.

```json
{ "id": "mp-abc", "crewId": "crew-abc" }
```

- This event uses a camelCase wrapper (`id`, `crewId`), while `crew:meeting-point-created` and `crew:meeting-point-updated` send the raw snake_case row and carry the crew id as `crew_id`. The shared router reads `p?.crew_id ?? p?.crewId`, so both shapes resolve; a new consumer must handle both.
- Raised over HTTP `DELETE /api/v1/crews/:crewId/meeting-points/:mpId`. Only the creator or the crew owner may remove.
- The removal is a soft delete: the row survives with `active` set to false
- **Rate limit:** 20 per 60s per userId (`crew-mp-delete`)

### `crew:status-updated`
A member set their arrival status. Sent to the whole `crew:<crewId>` room.

```json
{
  "status": {
    "crew_id": "crew-abc",
    "user_id": "user-abc123",
    "status": "on-my-way",
    "target_meeting_point_id": "mp-abc",
    "eta_minutes": 15,
    "note": "grabbing water first",
    "latitude": 42.5,
    "longitude": -85.8,
    "location_captured_at": "...",
    "updated_at": "..."
  }
}
```

- The stored row is wrapped under `status`, and every key inside it is snake_case. The outer `status` key and the inner `status` field are different values: `payload.status.status` is the member's own status string.
- The row has no `id` column. It is keyed on `crew_id` plus `user_id`.
- The snake_case is deliberate, so the client can show staleness from `updated_at`
- `latitude`, `longitude` and `location_captured_at` keep their previous values when the member sends a status without a position
- Raised over HTTP `PUT /api/v1/crews/:crewId/status`. A member may set only their own row.
- **Rate limit:** 60 per 60s per userId (`crew-status-update`)

### `crew:poll-created`
A member opened a poll. Sent to the whole `crew:<crewId>` room.

```json
{
  "pollId": "poll-abc",
  "question": "Which set at 9pm?",
  "options": ["Stage A", "Stage B"],
  "createdBy": "user-abc123"
}
```

- Raised over HTTP `POST /api/v1/crews/:crewId/polls`. A crew is capped at 3 active polls.
- **Rate limit:** 10 per 60s per userId (`crew-poll-create`)

### `crew:poll-voted`
A member voted. Sent to the whole `crew:<crewId>` room.

```json
{ "pollId": "poll-abc", "userId": "user-abc123", "optionIndex": 1 }
```

- The payload carries no totals. Clients must patch counts locally or refetch the poll.
- Raised over HTTP `POST /api/v1/crews/:crewId/polls/:pollId/vote`
- **Rate limit:** 60 per 60s per userId (`crew-poll-vote`)

### `crew:poll-closed`
A poll was closed. Sent to the whole `crew:<crewId>` room.

```json
{ "pollId": "poll-abc" }
```

- Raised over HTTP `DELETE /api/v1/crews/:crewId/polls/:pollId`. The route closes the poll; it does not delete the row.
- Only the poll creator or the crew owner may close a poll
- **Rate limit:** 10 per 60s per userId (`crew-poll-delete`)

### `crew:packing-created`
A member added a packing-list item. Sent to the whole `crew:<crewId>` room.

```json
{
  "item": {
    "id": "pack-abc",
    "crew_id": "crew-abc",
    "created_by": "user-abc123",
    "label": "camp stove",
    "brought_by": null,
    "claimed": false,
    "created_at": "..."
  }
}
```

- The stored row is wrapped under `item`, and every key inside it is snake_case
- Raised over HTTP `POST /api/v1/crews/:crewId/packing`. A crew is capped at 200 items.
- **Rate limit:** 30 per 60s per userId (`crew-packing-create`)

### `crew:packing-updated`
A packing-list item changed. Sent to the whole `crew:<crewId>` room.

```json
{
  "item": {
    "id": "pack-abc",
    "crew_id": "crew-abc",
    "created_by": "user-abc123",
    "label": "camp stove",
    "brought_by": "user-abc123",
    "claimed": true,
    "created_at": "..."
  }
}
```

- Same wrapper and same snake_case row as `crew:packing-created`
- Raised over HTTP `PUT /api/v1/crews/:crewId/packing/:itemId`. Any member may update any item.
- **Rate limit:** 60 per 60s per userId (`crew-packing-update`)

### `crew:packing-deleted`
A packing-list item was deleted. Sent to the whole `crew:<crewId>` room.

```json
{ "itemId": "pack-abc" }
```

- The crew id is not in the payload. The room carries it.
- Raised over HTTP `DELETE /api/v1/crews/:crewId/packing/:itemId`. Only the creator or the crew owner may delete.
- **Rate limit:** 30 per 60s per userId (`crew-packing-delete`)

### `crew:ride-created`
A member offered a ride. Sent to the whole `crew:<crewId>` room.

```json
{
  "offer": {
    "id": "ride-abc",
    "crew_id": "crew-abc",
    "created_by": "user-abc123",
    "driver": "alice",
    "seats": 3,
    "depart_from": "Grand Rapids",
    "depart_at": "...",
    "note": "leaving early",
    "created_at": "..."
  }
}
```

- The stored row is wrapped under `offer`, and every key inside it is snake_case
- Raised over HTTP `POST /api/v1/crews/:crewId/rides`. A crew is capped at 200 offers.
- **Rate limit:** 30 per 60s per userId (`crew-rides-create`)

### `crew:ride-updated`
A ride offer changed. Sent to the whole `crew:<crewId>` room.

```json
{
  "offer": {
    "id": "ride-abc",
    "crew_id": "crew-abc",
    "created_by": "user-abc123",
    "driver": "alice",
    "seats": 2,
    "depart_from": "Grand Rapids",
    "depart_at": "...",
    "note": "leaving early",
    "created_at": "..."
  }
}
```

- Same wrapper and same snake_case row as `crew:ride-created`
- Raised over HTTP `PUT /api/v1/crews/:crewId/rides/:itemId`
- **Rate limit:** 60 per 60s per userId (`crew-rides-update`)

### `crew:ride-deleted`
A ride offer was deleted. Sent to the whole `crew:<crewId>` room.

```json
{ "itemId": "ride-abc" }
```

- The key is `itemId`, not `rideId` or `offerId`, and the crew id is not in the payload
- Raised over HTTP `DELETE /api/v1/crews/:crewId/rides/:itemId`. Only the creator or the crew owner may delete.
- **Rate limit:** 30 per 60s per userId (`crew-rides-delete`)

### `crew:expense-added`
A member added an expense or recorded a settlement payment. Sent to the whole `crew:<crewId>` room.

```json
{
  "_v": 1,
  "crewId": "crew-abc",
  "expense": {
    "id": "6f1c...",
    "crew_id": "crew-abc",
    "paid_by": "user-abc123",
    "description": "ice run",
    "amount": "24.00",
    "split_with": ["user-abc123", "user-def456"],
    "category": "other",
    "planned": false,
    "created_at": "..."
  }
}
```

- The top-level keys are camelCase and carry `_v`, but the nested row is the stored row, so every key inside `expense` is snake_case
- `amount` is a `NUMERIC(10,2)` column, which the Postgres driver returns as a decimal string
- The settlement path (`POST /api/v1/crews/:crewId/expenses/settle`) reuses this event and sends the settlement row, with `category` set to `settlement`
- **Rate limit:** 30 per 60s per userId on `POST /api/v1/crews/:crewId/expenses` (`expense-create`), 20 per 60s per userId on the settle path (`expense-settle`)

### `crew:expense-deleted`
An expense was deleted. Sent to the whole `crew:<crewId>` room.

```json
{ "_v": 1, "crewId": "crew-abc", "expenseId": "6f1c..." }
```

- Raised over HTTP `DELETE /api/v1/crews/:crewId/expenses/:expenseId`. Only the payer may delete.
- **Rate limit:** 30 per 60s per userId (`expense-delete`)

### `crew:activity`
A crew activity row was written. Sent to the whole `crew:<crewId>` room.

```json
{
  "_v": 1,
  "crewId": "crew-abc",
  "item": {
    "id": "0f6b...",
    "crewId": "crew-abc",
    "userId": "user-abc123",
    "type": "poll-created",
    "detail": "Where should we camp?"
  }
}
```

- Producers, one per activity write: `crew-meeting-points.ts` (`home-base-updated`, `photo-album-updated`), `crew-polls.ts` (`poll-created`, `poll-voted`), `crew-packing.ts` (`packing-created`), `crew-rides.ts` (`ride-created`) and `crew-sos.ts` (`sos_raised`, `sos_cleared`). Every one calls `crewActivityLogged` in lib/emitter.ts, so all of them carry `_v`.
- `item` is a summary of the row that was written, not the row the REST feed returns. It has no `created_at` and no `username`, and its keys are camelCase while the REST row is snake_case. Treat `crewId` as the only stable field.
- Clients use this event as a refetch trigger only. The shared router keeps `crewId` and discards `item`, then the sink refetches `GET /api/v1/crews/:crewId/activity`, which stays the authoritative feed.
- The emit follows the activity write and never blocks the HTTP response. When the write fails there is no event.
- `routes/expenses.ts` writes two activity rows (`expense-added`, `expense_settled`) that do **not** emit yet. Those entries still arrive on the client's next poll. See "Open follow-ups".
- **Rate limit:** inherited from the route that wrote the row (10 to 30 per 60s per userId).

#### Session and lifecycle events

### `session:revoked`
The user revoked this session from another device. Sent to the matching sockets only, never to a room, and the server disconnects each socket immediately after.

```json
{ "reason": "Session revoked by user" }
```

- `reason` is `Session revoked by user` on `DELETE /api/v1/auth/sessions/:id` (routes/auth.ts:124) or `All other sessions revoked` on `DELETE /api/v1/auth/sessions` (routes/auth.ts:559)
- A socket matches when its user id matches and its session-token hash matches the revoked session. The revoke-all path matches every session except the caller's own.
- **Rate limit:** 10 per 60s per userId on `DELETE /api/v1/auth/sessions/:id` (`del-session`), 5 per 60s per userId on `DELETE /api/v1/auth/sessions` (`del-all-sessions`)

### `server:draining`
The server is shutting down. Broadcast to every connected socket, with no room.

```json
{ "message": "Server is shutting down" }
```

- The message string is fixed
- Sent once per process, after pending batched events are flushed and before the server disconnects sockets in batches
- Clients should stop sending and reconnect with backoff. The disconnect follows within milliseconds.
- **Rate limit:** none. It fires once per shutdown.

### `error`
```json
{ "message": "Realtime rate limit exceeded" }
```

- The join and leave paths send `message` only. Messages are `Realtime rate limit exceeded`, `Join this festival before using crew realtime` and `Failed to leave festival`.
- The `location:update` path adds a `code` key: `{ "message": "Invalid location payload", "code": "SCHEMA_MISMATCH" }`, and likewise `NOT_SHARING`, `RATE_LIMITED` and `NOT_A_MEMBER`

## The `_v` field

`_v` splits by subsystem, not by producer file. Two subsystems send it and one does not:

| Subsystem | Sends `_v` | Events |
|---|---|---|
| Emitter layer (`lib/emitter.ts`) | yes | `profile:created`, `profile:updated`, `profile:deleted`, `festival:created`, `festival:updated`, `festival:deleted`, `presence:update`, `crew:expense-added`, `crew:expense-deleted`, `crew:activity` |
| Live location and SOS | yes | `location:peer-update`, `location:peer-stopped`, `sos:raised`, `sos:cleared` |
| Crew CRUD routes | no | `crew:updated`, `crew:deleted`, `crew:reformed`, `crew:member-joined`, `crew:member-left`, `crew:member-kicked`, `crew:access-revoked`, `crew:home-base-updated`, `crew:photo-album-updated`, `crew:meeting-point-*`, `crew:status-updated`, `crew:poll-*`, `crew:packing-*`, `crew:ride-*` |

Two route files straddle that split, which is why the rule looks like a per-file one: `routes/crew-sos.ts` is a `routes/crew-*.ts` file yet both its events carry `_v`, and `routes/crew-members.ts` and `routes/admin-bulk.ts` emit `location:peer-stopped` with `_v`.

Read `_v` as reserved, not live:

- No client reads `_v` off an inbound event. Every occurrence in `packages/` is a client sending `_v: 1` outbound, a type declaration, or a test fixture.
- The server never branches on the value either. Inbound schemas validate it as `min(1).default(1)` and echo it back, so a client that sends `_v: 999` is treated exactly like one that sends `1`.
- `EVENT_VERSION` in lib/emitter.ts has never left `1`.

Two events disagree with themselves across producers, which is harmless only because nothing reads the field: `presence:update` carries `_v` from lib/emitter.ts but not from lib/presence.ts, and `profile:deleted` carries it from lib/emitter.ts but not from routes/admin-users.ts.

Do not backfill `_v` onto the crew CRUD events. Adding it is safe but changes no behaviour anywhere.

## Open follow-ups

Changes that are correct but must not ship in one step, or that belong to another owner.

- **Unify the meeting-point key casing: not attempted.** `created`/`updated` send the raw snake_case row while `removed` sends a camelCase wrapper. Adding a duplicate `crewId` to the row was considered and rejected: the shared router already falls back with `p?.crew_id ?? p?.crewId`, so nothing reads it, and the row shape is fixed by the REST list endpoint, the snake_case `CrewMeetingPoint` domain type and `tests/types/contracts.type-test.ts`. Renaming instead would break every shipped client. Left as-is, documented.
- **Emit `crew:activity` from `routes/expenses.ts`.** Its two activity writes (`expense-added`, `expense_settled`) are the only ones left with no event. That file belongs to another change.
- **Only after this server ships and old app binaries age out**, lower or remove the 30s activity-feed polls in `packages/mobile/components/CrewActivity.tsx` and `packages/web/src/components/crew/ActivityTab.tsx`. Until then the poll is the only refresh a shipped client has.
- **`RouteDeps.emitter` is mistyped** as a Node `EventEmitter` in lib/types/app-context.ts. server.ts injects the object from `createSocketEmitter`. Typed route modules cast through `SocketEmitter` (lib/emitter.ts) until that key is retyped.
- **`crew:member-kicked` deliberately carries no `username`**, unlike `crew:member-joined` and `crew:member-left`. Re-reviewed and kept: the only subscriber filters the roster it already holds by `userId`, and neither producer has the username in scope, so adding it would cost a database read per kick for a field with no reader.
- **`totem_name` and `totem_emoji` stay snake_case** inside the otherwise camelCase `crew:updated` payload. Re-reviewed and kept: no client reads the `crew:updated` body at all — both `useRealtimeSync` handlers take the crew id and refetch over REST — and the casing is REST-wide, codified in lib/responseSchemas.ts and in the generated API types.

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

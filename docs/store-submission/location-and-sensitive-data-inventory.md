# Festie 1.3.0 — Location and sensitive data inventory

Scope: location, photos, push identifiers, and the consent surfaces around them.
Purpose: source text for the App Store privacy labels and the Play Data-safety form.
Method: every claim below cites a file and line in this repository. Nothing is inferred from product
description. Where the code does not settle a question, the entry says **UNDETERMINED** and names the
check the owner must make.

Read this next to the two forms. Section 8 gives the answers in form order.

---

## 1. Summary table

| Data | Collected | Linked to identity | Used for tracking | Shared with a third party |
|---|---|---|---|---|
| Precise location — live crew sharing | Yes | Yes (user id) | No | No |
| Precise location — offline status breadcrumb | Yes | Yes (user id) | No | No |
| Precise location — meeting point coordinates | Yes | Yes (creator user id) | No | No |
| Coarse location — SOS coordinate | Yes | Yes (user id) | No | **Yes — Apple APNs and Google FCM** |
| Photos — avatar image | Yes | Yes (user id) | No | No |
| Device push token | Yes | Yes (user id) | No | **Yes — Apple APNs and Google FCM** |
| Device name | Yes | Yes (user id) | No | No |
| Crash and performance data | Yes, when a DSN is set | See 6.3 | No | **Yes — Sentry** |

Tracking is "No" everywhere. The app declares `NSPrivacyTracking: false`
(`packages/mobile/app.json:29`) with an empty tracking-domain list (`app.json:30`). The dependency
list contains no advertising, attribution, or third-party analytics SDK
(`packages/mobile/package.json:17-68`). There is no App Tracking Transparency call anywhere in the
mobile package.

---

## 2. Live location — is it persisted?

**Answer: it is never written to PostgreSQL. It is held for at most 120 seconds in a Redis cache, and
never written to disk on the device.**

### 2.1 The relay path

The client publishes fixes over Socket.IO. The server rebroadcasts them to the crew room and writes
nothing to PostgreSQL.

- Publisher emits `location:update` per throttled fix — `packages/shared/src/hooks/useLiveLocationPublisher.ts:138-157`
- Server rebroadcasts to the crew room only — `routes/socket.ts:597`

```
socket.to('crew:' + crewId).emit('location:peer-update', payload);   // routes/socket.ts:597
```

No handler in `routes/socket.ts` issues a PostgreSQL write. The four handlers are `location:share`
(line 428), `location:update` (line 512), `location:stop` (line 605) and `location:sync` (line 658).
The design intent is stated at `routes/socket.ts:422-426` and repeated at `lib/schemas.ts:846-851`.

### 2.2 What makes it ephemeral on the device

The client store is created without persistence middleware.

```
// NOTE: plain create() — NO persist middleware. Ephemerality is a hard privacy
// requirement (see file header). Do not wrap this in persist().
export const useLiveLocationStore = create<LiveLocationStore>()(liveLocationStore);
```
`packages/shared/src/stores/liveLocationStore.ts:201-203`

Coordinates therefore live in memory for the app session only. The sharing toggle resets to off on
every launch (`liveLocationStore.ts:95-105`, `EMPTY.sharingCrewId = null`).

### 2.3 What makes it ephemeral on the server

Each broadcast fix is also cached in Redis so a late-joining client sees peers at once.

- Write on share and on update — `routes/socket.ts:501` and `routes/socket.ts:599`
- Storage and expiry — `lib/live-location-cache.ts:61-65`

```
pipeline.hset(key, payload.userId, JSON.stringify(payload));
pipeline.pexpire(key, POSITION_TTL_MS);
```

`POSITION_TTL_MS = 120_000` — `lib/live-location-cache.ts:40`.

**Exact retention: 120 seconds, refreshed on each new fix.** Four events delete the entry sooner:

| Event | Line |
|---|---|
| User leaves the crew | `routes/socket.ts:409` |
| Membership revoked mid-stream | `routes/socket.ts:568` |
| User stops sharing | `routes/socket.ts:632` |
| Socket disconnects | `routes/socket.ts:769` |

The read path drops any entry older than 120 seconds, so a lingering field can never be served
(`lib/live-location-cache.ts:145-146`).

### 2.4 Precision and session limits

Live coordinates carry full device precision. The schema bounds the range but does not round
(`lib/schemas.ts:856-857`, `lib/schemas.ts:891-892`). The server passes `lat` and `lng` through
unchanged (`routes/socket.ts:580-581`).

Sharing is time-boxed. The user picks a duration before sharing starts: 1 hour, 2 hours, 4 hours, or
"until the festival ends" (`packages/shared/src/constants/config.ts:195-200`). The default is 2 hours
(`config.ts:203`). The "until the festival ends" option is clamped to 12 hours
(`config.ts:187`, `config.ts:206-208`). The publisher auto-stops at the chosen bound
(`useLiveLocationPublisher.ts:168-171`).

---

## 3. The SOS exception — confirmed persisted location

**Confirmed. An SOS attaches one coarse coordinate to a durable database row and to a push
notification.**

### 3.1 Precision

```
/** Round a coordinate to ~4 decimals (~11m) — coarse enough for privacy, precise enough to find someone. */
function coarse(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
```
`routes/crew-sos.ts:54-57`

Applied at `routes/crew-sos.ts:96-97`. **Four decimal places. That is about 11 metres of latitude,
and 11 metres or less of longitude.** For the App Store label this is coarse location, not precise
location. For the Play form it falls under "Approximate location".

The coordinate is optional. It is present only when the device returned a fix before a four-second
timeout, and only when the user granted foreground location permission
(`packages/mobile/components/CrewSos.tsx:111-127`).

### 3.2 Where the row lives

The coordinate is appended to the free-text detail column as `@lat,lng`.

```
if (position) detailParts.push(`@${position.lat},${position.lng}`);
```
`routes/crew-sos.ts:107`, written at `routes/crew-sos.ts:112` through `lib/db/stores/activity.ts:6-20`.

Table: `crew_activity (id, crew_id, user_id, type, detail, created_at)` —
`migrations/020_phase3_features.sql:18-25`. The row is linked to the raiser's user id and is readable
by every member of that crew (`lib/db/stores/activity.ts:22-45`).

### 3.3 For how long

**There is no age-based deletion of `crew_activity`.** The row survives until one of these happens:

| Deletion trigger | Evidence |
|---|---|
| The crew is deleted | FK `ON DELETE CASCADE` — `migrations/020_phase3_features.sql:20` |
| Account hard-deleted by the user | `lib/db/stores/users.ts:246` |
| The parent festival was soft-deleted over 90 days ago | `migrations/060_retention_cleanup_owned_crews.sql:95` |
| The user was soft-deleted over 30 days ago | `migrations/060_retention_cleanup_owned_crews.sql:152` |

**UNDETERMINED — is `retention_cleanup()` ever executed?** The function is defined in migrations 034,
037, 053 and 060. No file in `scripts/`, `lib/`, `config/` or `server.ts` calls it, and
`scripts/setup-crons.sh` does not schedule it. Owner check: run `crontab -l` on the production host
and inspect any systemd timer, then state a real retention period. If nothing schedules it, the honest
answer for both forms is that SOS coordinates are retained until the account or crew is deleted.

### 3.4 A second durable copy of the SOS coordinate

The push fan-out is also written to the notification log.

- The push data carries the coordinate as strings — `routes/crew-sos.ts:242-246`
- Every send is logged with the data serialised to JSON — `lib/notifications/send.ts:176-186`

```
dataJson: data ? JSON.stringify(data) : null,   // lib/notifications/send.ts:182
```

Table: `notification_log (…, data_json JSONB, …)` — `migrations/004_postgresql_baseline.sql:241-253`.
One row per recipient device. Deleted on account hard delete (`lib/db/stores/users.ts:232`) and by the
30-day soft-delete purge (`migrations/060_retention_cleanup_owned_crews.sql:122`). The same
`retention_cleanup()` scheduling question in 3.3 applies here.

Declare the SOS coordinate once, but know it exists in two tables when answering a deletion request.

---

## 4. Is location ever sent off the server?

### 4.1 Yes — the SOS coordinate reaches Apple and Google

This is the one confirmed third-party disclosure of user location.

The fan-out puts the coarse coordinate in the push data payload:

```
if (position) {
  data.lat = String(position.lat);
  data.lng = String(position.lng);
}
```
`routes/crew-sos.ts:243-246`

That payload flows into both transports:

| Transport | Recipient | Evidence |
|---|---|---|
| APNs, for `platform = 'ios'` tokens | Apple | Payload built at `lib/notifications/send.ts:248-261` (`...data` at line 259); sent at `send.ts:421-440`; endpoint `https://api.push.apple.com` at `lib/notifications/apns.ts:25` |
| FCM, for Android and web tokens | Google | Message built at `lib/notifications/send.ts:209-238` (`data: { type, ...data }` at line 212); sent at `send.ts:452-462` |

Both transports are configuration-gated. FCM is inert without `FIREBASE_CREDENTIALS_PATH`
(`lib/notifications/send.ts:34-36`). APNs is inert without the `.p8` key set
(`lib/config.ts:571-576`). **Owner check: confirm both are configured in production before declaring
"shared". If both are unconfigured the sharing does not occur.** The existing privacy policy already
names Firebase Cloud Messaging as a processor (`public/privacy.html:282`), which implies FCM is live.

### 4.2 No — no other outbound call carries a user coordinate

- **Weather (Open-Meteo).** `routes/weather.ts:38` sends `latitude` and `longitude` to
  `https://api.open-meteo.com`. Those values come from the `festivals` table
  (`routes/weather.ts:23`, `routes/weather.ts:30`). They are the venue's coordinates, not any user's.
  No declaration needed.
- **Sentry.** No code path sends coordinates to Sentry. The server sets `sendDefaultPii: false`
  (`lib/sentry.ts:48`) with a `beforeSend` filter (`lib/sentry.ts:49`). Mobile init passes only a DSN
  and a trace rate (`packages/mobile/app/_layout.tsx:64-68`). SOS and status coordinates travel in
  POST bodies, and no request-body capture is enabled.
- **Analytics endpoints.** `routes/analytics-install.ts` accepts platform, event, reason, engagement
  time and user agent only (`routes/analytics-install.ts:26`, `:47-57`). No coordinate field exists.

### 4.3 Two items needing an owner judgement, not a code answer

- **OpenStreetMap tiles.** The map fetches raster tiles from `https://tile.openstreetmap.org`
  (`packages/mobile/components/OfflineMap.tsx:118-124`) while the map can also follow the device
  position (`OfflineMap.tsx:446-460`). No coordinate is uploaded. The tile URL encodes the map
  viewport, and OpenStreetMap sees the device IP address. Most reviewers treat basemap tile fetching
  as app functionality, not location sharing. **UNDETERMINED as a declaration. Owner decides, and
  should be ready to explain the reasoning if asked.**
- **Directions hand-off.** Opening directions launches `https://maps.google.com/?q=lat,lng` with the
  saved meeting point coordinate (`packages/mobile/components/CrewMeetingPoints.tsx:162-171`). This is
  a user-initiated hand-off to another app, and the coordinate is the meeting point, not the user's
  position. It is normally out of scope for both forms.

---

## 5. Two more persisted precise-location stores

Both are precise, both are linked to the user, and neither is coarsened. They must be declared.

### 5.1 Offline status breadcrumb — `crew_member_status`

The status form captures the device position and sends it with the status update.

- Capture — `packages/mobile/components/CrewStatus.tsx:106-124`, `Location.Accuracy.High` at line 115
- Route write — `routes/crew-status.ts:83-93`
- Columns — `migrations/055_offline_presence_and_recurring_meets.sql:29-31`
  (`latitude`, `longitude`, `location_captured_at`, all `DOUBLE PRECISION` / `TIMESTAMPTZ`)
- Upsert — `lib/db/stores/crews.ts:1109-1132`

Precision: full device precision. The schema bounds the range only
(`lib/schemas.ts:827-833`). No rounding exists on any path.

Visibility: broadcast to the whole crew room and returned in the status payload
(`routes/crew-status.ts:98`).

**Retention: UNDETERMINED, and there is a gap.** The row is deleted on account hard delete
(`lib/db/stores/users.ts:244`) and cascades when the crew is deleted
(`migrations/051_crew_member_status.sql:16`). It is **not** deleted by `retention_cleanup()` — no
migration references `crew_member_status`. A row also survives a value update only until the next
position is sent, because the upsert coalesces rather than clears
(`lib/db/stores/crews.ts:1132`). Owner check: decide the retention answer, and consider whether the
purge gap needs a fix before the public release.

### 5.2 Meeting point coordinates — `crew_meeting_points`

- Capture — `packages/mobile/components/CrewMeetingPoints.tsx:139-158`, `Location.Accuracy.High` at line 152
- Route write — `routes/crew-meeting-points.ts:148`, `:169`
- Columns — `migrations/050_meeting_point_coords.sql:7-8` (both `DOUBLE PRECISION`, nullable)

Precision: full device precision, no rounding.

Retention: deleted with the crew (`migrations/017_meeting_points.sql:6`, cascade), on account hard
delete of the creator (`lib/db/stores/users.ts:239`), and by the two `retention_cleanup()` branches
(`migrations/060_retention_cleanup_owned_crews.sql:85`, `:143`). The same scheduling question applies.

Note: this is a place, not a person's position, but the capture button records where the user stood.
Declare it as precise location.

**Consistency check for the owner.** `public/privacy.html:126` already documents 5.1 and 5.2. It does
**not** mention the SOS coordinate in `crew_activity` or `notification_log`. Update the policy before
the release, so the store declaration, the policy, and the code agree.

---

## 6. Photos — the avatar path

### 6.1 What is uploaded and what is stored

| Step | Detail | Evidence |
|---|---|---|
| Endpoint | `POST /account/avatar`, authenticated, rate limited to 10 | `routes/account.ts:274-278` |
| Transport | multer memory storage, one file, size and MIME limited | `lib/app-context/avatar.ts:64-80` |
| Processing | Sharp resize to a square, re-encode to WebP | `lib/avatar-worker.ts:28-31` |
| Stored file | `PUBLIC_DIR/uploads/avatars/<key>.webp`, key is 24–64 hex chars | `lib/app-context/avatar.ts:27-41` |
| Database | `avatarKey`, `avatarVersion`, `avatarUpdatedAt` on the user row | `routes/account.ts:289-293` |

The original uploaded bytes exist only in memory. Only the processed WebP is written
(`routes/account.ts:282-288`).

### 6.2 EXIF, including GPS

**EXIF is not carried into the stored file.**

```
const result = await sharp(buf, { failOn: 'error', limitInputPixels: maxPixels })
  .rotate()
  .resize(size, size, { fit: 'cover', position: 'centre' })
  .webp({ quality, effort: 4 })
  .toBuffer();
```
`lib/avatar-worker.ts:28-33`

Two facts settle this. Sharp drops all input metadata unless `withMetadata()` or `keepMetadata()` is
called, and neither appears anywhere in the repository — the only two Sharp imports are
`lib/avatar-worker.ts:11` and `routes/export.ts:17`, and a repository-wide grep for `withMetadata`,
`keepMetadata` and `keepExif` returns nothing. Second, `.rotate()` with no argument applies the EXIF
orientation and then discards the tag. The output WebP therefore contains no EXIF block, and no GPS
tag.

Practical effect: a photo's embedded location never reaches storage. **Declare photos, and do not
declare a location component for them.**

### 6.3 Access to the stored avatar

The avatar directory is served by static file middleware with no authentication
(`lib/middleware.ts:253-269`). Anyone holding the URL can fetch the image. The filename is
12 random bytes rendered as 24 hex characters, generated per user (`routes/account.ts:286`), so the URL is unguessable but
not access-controlled. This is a normal pattern for profile images. Note it if a reviewer asks how
avatars are protected.

Permission prompt: the photo library string is
"Allow Festie to access your photos to set your avatar." (`packages/mobile/app.json:182`).

---

## 7. Push notification identifiers

### 7.1 What is collected

| Field | Source | Evidence |
|---|---|---|
| Device push token | `Notifications.getDevicePushTokenAsync()` | `packages/mobile/hooks/useMobilePush.ts:128` |
| Platform | `Platform.OS` | `useMobilePush.ts:131` |
| Device name | `Device.deviceName` | `useMobilePush.ts:132` |

The token is a raw APNs device token on iOS and an FCM registration token on Android
(`lib/notifications/apns.ts:7-12`). It is not an advertising identifier. No IDFA, AAID, or
attribution SDK exists in the dependency list.

**Treat `device_name` with care.** It is the user's own device name, which is frequently a personal
name such as "Sam's iPhone". It is stored and linked to the account.

### 7.2 Where it is stored

`device_tokens (id, user_id, token UNIQUE, platform, device_name, created_at, last_used_at,
expires_at)` — `migrations/004_postgresql_baseline.sql:214-222`.

Retention: `expires_at` defaults to `NOW() + INTERVAL '90 days'`
(`migrations/004_postgresql_baseline.sql:222`). Rows are deleted on account hard delete
(`lib/db/stores/users.ts:234`) and by the 30-day soft-delete purge
(`migrations/060_retention_cleanup_owned_crews.sql:128`). The registration endpoint enforces a
per-user token cap and evicts the oldest (`routes/notifications.ts:67-71`).

A copy of the token is also held on the device in AsyncStorage (`useMobilePush.ts:135`).

### 7.3 Which third parties receive it

Both, by definition of the transport:

- **Apple** receives iOS tokens — `lib/notifications/send.ts:415-440`, endpoint at `lib/notifications/apns.ts:25`
- **Google** receives Android and web tokens through Firebase Cloud Messaging — `lib/notifications/send.ts:452-462`, initialised at `lib/notifications/send.ts:32-49`

The token is created by the platform push service, so this is standard. Declare it as a device
identifier that is shared.

---

## 8. Consent and permission prompts

### 8.1 Declared permission strings

| Platform | String | Evidence |
|---|---|---|
| iOS, when-in-use | "Festie uses your location to drop a meeting point, point you toward your crew, and—only when you turn it on—share your live location with your crew or send an SOS. Only used while the app is open." | `packages/mobile/app.json:25` and `:203` |
| Android | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | `packages/mobile/android/app/src/main/AndroidManifest.xml:2-3` |

**There is no background or always-on location.** No `NSLocationAlwaysAndWhenInUseUsageDescription`
exists in `app.json`, and no `ACCESS_BACKGROUND_LOCATION` appears in the manifest. Every runtime call
is `requestForegroundPermissionsAsync`.

### 8.2 Every runtime prompt

| Feature | Call site |
|---|---|
| Live location sharing | `packages/mobile/components/CrewLiveLocation.tsx:232` |
| SOS | `packages/mobile/components/CrewSos.tsx:111` |
| Meeting point capture | `packages/mobile/components/CrewMeetingPoints.tsx:143` |
| Status breadcrumb | `packages/mobile/components/CrewStatus.tsx:110` |
| Map, follow position | `packages/mobile/components/OfflineMap.tsx:446` |
| Map, recentre | `packages/mobile/components/OfflineMap.tsx:955` |
| Meeting point compass | `packages/mobile/components/MeetingPointCompass.tsx:134` |

Every one of the seven is a foreground request. Web uses the browser Geolocation API instead
(`packages/web/src/components/crew/LiveLocationControls.tsx:104`).

### 8.3 What the user is told in the app

Live location sharing shows this line above the toggle:

> "Only this crew can see it, only while the app is open. Off by default — it stops when you close the app."

`packages/mobile/components/CrewLiveLocation.tsx:299-300`

Turning the toggle on opens a duration sheet before any sharing starts
(`CrewLiveLocation.tsx:317-318`). A denied permission routes the user to Settings rather than looping
(`CrewLiveLocation.tsx:236-251`).

The in-app claim matches the code. Sharing is opt-in, off on every launch (section 2.2), scoped to one
crew (`routes/socket.ts:439`, `:450-451`), and time-boxed (section 2.4).

**One wording caution.** The SOS coordinate is durable, but no SOS screen tells the user that. The
copy at `CrewSos.tsx` explains the alert, not the retention. Consider adding one line before public
release, because both stores compare the declaration against what the app tells the user.

---

## 9. Answers in form order

### 9.1 App Store — App Privacy

| Question | Answer | Basis |
|---|---|---|
| Precise Location — collected | Yes | Sections 2, 5.1, 5.2 |
| Precise Location — linked to the user | Yes | User id on every path |
| Precise Location — used for tracking | No | `app.json:29-30`; no ad or attribution SDK |
| Precise Location — purpose | App Functionality | Crew coordination and safety |
| Coarse Location — collected | Yes | Section 3, four decimal places |
| Coarse Location — linked / tracking | Linked, not tracking | Section 3 |
| Photos or Videos — collected | Yes | Section 6 |
| Photos — linked / tracking | Linked, not tracking | Stored against the user row |
| Device ID — collected | Yes | Section 7, push token and device name |
| Device ID — linked / tracking | Linked, not tracking | Section 7.2 |
| User ID, Email Address | Yes, linked, not tracking | Already declared at `app.json:41-71` |
| Crash Data | Yes, when Sentry is configured | `app.json:81-87`; `_layout.tsx:63-68` |

The existing privacy manifest at `packages/mobile/app.json:31-96` already declares precise location,
email, photos, other user content, user id, device id, crash data and product interaction. It is
consistent with this inventory. **Coarse location is the one category the manifest does not carry
separately.** Apple's manifest has no coarse-location type distinct from
`NSPrivacyCollectedDataTypePreciseLocation`, so the existing entry covers it. On the App Store Connect
form itself, tick both Precise and Coarse Location.

### 9.2 Play — Data safety

| Question | Answer | Basis |
|---|---|---|
| Location — Approximate location — collected | Yes | Section 3 |
| Location — Precise location — collected | Yes | Sections 2, 5.1, 5.2 |
| Location — shared | **Yes, approximate only**, to Apple and Google as push processors | Section 4.1 |
| Location — required or optional | Optional. Every feature works without it | Sections 3.1, 8.3 |
| Location — purpose | App functionality | — |
| Location — processed ephemerally | **No.** Live sharing is ephemeral, but the SOS, status and meeting point coordinates persist | Sections 3.2, 5 |
| Photos — collected, not shared | Yes, collected. Optional. App functionality | Section 6 |
| Device or other IDs — collected | Yes. Shared with Apple and Google | Section 7 |
| Crash logs — collected | Yes, when Sentry is configured. Shared with Sentry | Section 4.2 |
| Data encrypted in transit | Yes. HTTPS and WSS throughout | `packages/mobile/app/_layout.tsx:72` |
| Users can request deletion | Yes | `lib/db/stores/users.ts:230-252` |

Do not tick "Data is processed ephemerally" for location. It is true of the live relay and false of
the three persisted coordinates. Ticking it would be the mismatch that gets the app removed.

---

## 10. Open items the owner must close

1. **Is `retention_cleanup()` scheduled in production?** Nothing in the repository calls it. Check the
   host crontab and any systemd timer. This determines the retention answer for SOS coordinates,
   notification logs, and device tokens. See 3.3.
2. **Are FCM and APNs both configured in production?** Both are inert without credentials. This
   determines whether "location shared with a third party" is Yes or No. See 4.1.
3. **`crew_member_status` is not covered by `retention_cleanup()`.** A soft-deleted user's precise
   coordinate can outlive the automated purge. Decide whether to fix it before the public release, or
   to state the longer retention. See 5.1.
4. **The privacy policy omits the SOS coordinate.** `public/privacy.html:126` documents the status and
   meeting point coordinates only. Add the `crew_activity` and `notification_log` copies. See 3.4.
5. **Decide the OpenStreetMap tile position.** No coordinate leaves the device, but tile requests and
   the device IP reach OpenStreetMap. See 4.3.
6. **Consider one line of SOS copy** that says the coordinate is stored in the crew's activity feed.
   See 8.3.

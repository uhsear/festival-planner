# Festie 1.3.0 — App Store privacy labels and Play Data-safety draft

**Purpose.** This is a transcription sheet. Read it next to App Store Connect and the Play Console
and copy the answers across. Every "yes" cites a file and a line. Where the code cannot settle an
answer, the entry says **UNDETERMINED** and names the exact thing you must check.

**Scope.** The two store forms describe the shipped mobile app (iOS and Android) and the server it
talks to. The Festie website (`packages/web`) is out of scope for both forms. Two data flows exist
only on the website and are therefore excluded from both declarations: the PWA install-funnel
endpoint (`routes/analytics-install.ts:24`) and the web-vitals beacon
(`packages/web/src/lib/web-vitals.ts:75-84`).

---

## 1. Summary in plain language

Festie collects the data an account needs and the data crew coordination needs, and nothing for
advertising. At registration it takes a username, a password, a date of birth for an 18+ gate, and
an optional email address. In use it takes an optional profile photo, an optional display name,
optional payment handles for settle-up links, and free text such as crew names, meeting-point
labels, set notes and SOS messages. It uses precise device location in three ways: a live
crew-sharing relay that is opt-in, time-boxed and never written to the database; a full-precision
"last seen" breadcrumb and meeting-point coordinate that ARE written to the database; and a
coordinate rounded to about 11 metres that is stored permanently in the crew activity feed whenever
a user raises an SOS. That SOS coordinate is also placed in the push payload, so it passes through
Apple's and Google's push infrastructure. The app registers a push device token and the device's own
name. It sends crash and performance data to Sentry. It contains no advertising SDK, no attribution
SDK, no third-party analytics SDK, and no advertising identifier, so nothing is used for tracking.

---

## 2. App Store privacy labels

Answer every category. Apple requires a response for all of them.

Global answers:
- **Used for tracking:** No, for every category. `packages/mobile/app.json:29-30` sets
  `NSPrivacyTracking: false` with an empty `NSPrivacyTrackingDomains`. No advertising, attribution
  or third-party analytics SDK appears in `packages/mobile/package.json:17-80`. The Android manifest
  requests no `AD_ID` permission (`packages/mobile/android/app/src/main/AndroidManifest.xml:2-10`).
- **Purpose, where a type is collected:** App Functionality, unless stated otherwise.

### 2.1 Contact Info — COLLECTED

| Sub-type | Collected | Linked | Tracking | Purpose | Evidence |
|---|---|---|---|---|---|
| Email Address | Yes (optional) | Yes | No | App Functionality | `migrations/009_email_and_reset_tokens.sql:4`; optional at registration, `lib/schemas.ts:71`; sent to Resend at `lib/email.ts:67` |
| Name | No | — | — | — | See the note below on display name and device name |
| Phone Number | No | — | — | — | No phone-number column exists in any migration; `expo-sms` opens the OS composer only and never reads a number (`packages/mobile/components/SmsHandoff.tsx:45`) |
| Physical Address | No | — | — | — | No address field exists |
| Other User Contact Info | No | — | — | — | — |

Note on "Name": the editable display name (`migrations/041_user_display_name.sql:6`) is a chosen
label, not a legal name, and Festie never asks for a real name. Declare it under User Content →
Other User Content, not Contact Info. The device name sent with the push token
(`packages/mobile/hooks/useMobilePush.ts:132`) is frequently a personal name in practice; see 2.14.

### 2.2 Health & Fitness — NOT COLLECTED

No HealthKit entitlement, no pedometer, no fitness data. The only sensor used is the magnetometer,
for a compass heading, and it is read on-device and never transmitted
(`packages/mobile/components/MeetingPointCompass.tsx:24, 111`). `RECORD_AUDIO` is explicitly removed
(`packages/mobile/android/app/src/main/AndroidManifest.xml:7`).

### 2.3 Financial Info — COLLECTED

| Sub-type | Collected | Linked | Tracking | Purpose | Evidence |
|---|---|---|---|---|---|
| Payment Info | No | — | — | — | Festie processes no payments and stores no card or bank data |
| Credit Info | No | — | — | — | — |
| Other Financial Info | Yes | Yes | No | App Functionality | Payment handles: `migrations/042_payment_handles.sql:8-10`, route `routes/account.ts:432-445`. Crew expense amounts and descriptions: `migrations/020_phase3_features.sql:4-14` |

Both items are visible to other crew members. Payment handles are returned by
`serializePublicUser` (`lib/helpers.ts:65-67`). Expenses are shared by design, since the feature is
splitting costs inside a crew.

### 2.4 Location — COLLECTED, both Precise and Coarse

Tick **Precise Location** and **Coarse Location**. Linked to the user. Not used for tracking.
Purpose: App Functionality.

Four distinct location flows exist. State them plainly if App Review asks.

1. **Live crew sharing — precise, not stored in the database.** The client publishes fixes at
   `packages/shared/src/hooks/useLiveLocationPublisher.ts:138-157`. The server only rebroadcasts to
   the crew room (`routes/socket.ts:597`), and none of the four socket handlers writes to
   PostgreSQL. Full device precision, no rounding (`routes/socket.ts:580-581`). Off on every launch,
   one crew at a time, and time-boxed with an auto-stop
   (`packages/shared/src/hooks/useLiveLocationPublisher.ts:168-171`). Each fix is cached in Redis
   with a 120-second rolling TTL (`lib/live-location-cache.ts:40, 61-65`), and reads discard anything
   older (`lib/live-location-cache.ts:145-146`).
2. **SOS coordinate — coarse, stored permanently.** Rounded to four decimal places, about 11 metres,
   by `coarse()` at `routes/crew-sos.ts:54-57`, applied at `routes/crew-sos.ts:96-97`. Appended to
   the crew activity row's free-text detail at `routes/crew-sos.ts:107` and written at
   `routes/crew-sos.ts:112`. The table `crew_activity` has no age-based deletion
   (`migrations/020_phase3_features.sql:18-25`). A second durable copy is serialised into
   `notification_log.data_json` for each recipient (`lib/notifications/send.ts:182`).
3. **Status breadcrumb — precise, stored, and not covered by the purge.** Captured at
   `Location.Accuracy.High` (`packages/mobile/components/CrewStatus.tsx:115`), written by
   `routes/crew-status.ts:83-93` into columns added by
   `migrations/055_offline_presence_and_recurring_meets.sql:29-31`. No rounding
   (`lib/schemas.ts:827-833` bounds the range only). See 5.3: `retention_cleanup()` never deletes
   this table.
4. **Meeting-point coordinate — precise, stored.** Captured at `Location.Accuracy.High`
   (`packages/mobile/components/CrewMeetingPoints.tsx:152`), written by
   `routes/crew-meeting-points.ts:148, :169`, columns from `migrations/050_meeting_point_coords.sql:7-8`.

**Background location is not collected.** There is no
`NSLocationAlwaysAndWhenInUseUsageDescription` in `packages/mobile/app.json`, no
`ACCESS_BACKGROUND_LOCATION` in the Android manifest
(`packages/mobile/android/app/src/main/AndroidManifest.xml:2-10`), and every runtime call site uses
`requestForegroundPermissionsAsync`.

**Location leaves Festie's servers in one place.** The SOS push payload carries `lat` and `lng`
(`routes/crew-sos.ts:243-246`), which reach Apple APNs (`lib/notifications/apns.ts:25`,
`lib/notifications/send.ts:259`) and Google FCM (`lib/notifications/send.ts:212`).

### 2.5 Sensitive Info — NOT COLLECTED

Apple's Sensitive Info type covers racial or ethnic data, sexual orientation, pregnancy, disability,
religious or political belief, trade-union membership, genetic data and biometric data. Festie
collects none of these. No column, schema or route in the repository stores any of them.

Date of birth is collected but is not an Apple Sensitive Info sub-type. Declare it under Other Data;
see 2.14.

### 2.6 Contacts — NOT COLLECTED

The app never reads the address book. `expo-contacts` is not a dependency
(`packages/mobile/package.json:17-80`), no contacts permission appears in the Android manifest, and
no contacts usage string appears in `packages/mobile/app.json:23-26`. Crew invites work from a join
code, not from a contact list. `expo-sms` hands a prefilled body to the OS composer and never
learns a recipient (`packages/mobile/components/SmsHandoff.tsx:45`).

### 2.7 User Content — COLLECTED

| Sub-type | Collected | Linked | Tracking | Purpose | Evidence |
|---|---|---|---|---|---|
| Photos or Videos | Yes | Yes | No | App Functionality | Avatar upload, `routes/account.ts:274-293`; processing `lib/avatar-worker.ts:28-33` |
| Emails or Text Messages | No | — | — | — | Festie sends transactional email; it never reads a user's mail or messages |
| Audio Data | No | — | — | — | `RECORD_AUDIO` removed, Android manifest line 7 |
| Gameplay Content | No | — | — | — | — |
| Customer Support | No | — | — | — | No in-app support ticket surface exists |
| Other User Content | Yes | Yes | No | App Functionality | See the list below |

Other User Content covers: display name (`migrations/041_user_display_name.sql:6`); festival profile
name and set notes (`migrations/004_postgresql_baseline.sql:111, 113, 140`); crew name, totem name
and totem emoji (`migrations/004_postgresql_baseline.sql:160`,
`migrations/056_crew_totem.sql:16-17`); the crew photo-album URL, which is a link only and hosts no
photos on Festie (`migrations/052_crew_photo_album.sql:11`); meeting-point label and location text
(`migrations/017_meeting_points.sql:8-9`); crew status note, capped at 280 characters
(`migrations/051_crew_member_status.sql:22`, `lib/schemas.ts:840`); the SOS message
(`routes/crew-sos.ts:93`); set ratings and their notes (`migrations/023_capture_drift.sql:9-18`); and
festival picks (`migrations/004_postgresql_baseline.sql:113`).

**The avatar carries no location.** Sharp discards all input metadata unless `withMetadata()` or
`keepMetadata()` is called, and a repository-wide search for those calls returns nothing. `.rotate()`
with no argument consumes and drops the EXIF orientation tag
(`lib/avatar-worker.ts:28-33`). The stored WebP has no EXIF and no GPS tag. Do **not** tick a
location component for photos.

**Avatar files are served without authentication.** `express.static` at `lib/middleware.ts:253-269`
serves `/uploads/avatars` with a 365-day immutable cache. The key is 12 random bytes
(`routes/account.ts:286`), so the URL is unguessable, but it is not access-controlled.

### 2.8 Browsing History — NOT COLLECTED

The app has no web browser and records no browsing. Sentry's default fetch and XHR breadcrumbs
record the request method, URL and status code only, and they attach to crash events rather than
being a browsing log. Nothing in the repository stores a browsing history.

### 2.9 Search History — NOT COLLECTED

A search for `searchHistory`, `recentSearch` and `search_history` across `packages`, `lib` and
`routes` returns zero matches. Search inside the app runs against locally held festival data and is
never sent to the server or stored.

### 2.10 Identifiers — COLLECTED

| Sub-type | Collected | Linked | Tracking | Purpose | Evidence |
|---|---|---|---|---|---|
| User ID | Yes | Yes | No | App Functionality | Username, `migrations/004_postgresql_baseline.sql:18`; internal account id used as the primary key at line 17 |
| Device ID | Yes | Yes | No | App Functionality | Push device token, `packages/mobile/hooks/useMobilePush.ts:128-133`; stored in `device_tokens`, `migrations/004_postgresql_baseline.sql:214-222` |

The Device ID here is a push token, not an advertising identifier. There is no IDFA, no AAID and no
`AppTrackingTransparency` call anywhere in `packages/mobile`.

**Username reaches two third parties.** It appears in transactional email bodies sent through Resend
(`routes/auth.ts:60`, `lib/email.ts:67`) and in push notification titles, for example
`${username} raised an SOS` at `routes/crew-sos.ts:252`.

### 2.11 Purchases — NOT COLLECTED

Festie sells nothing. No in-app purchase or billing library appears in
`packages/mobile/package.json:17-80`, and no purchase or receipt table exists in `migrations/`. Crew
expenses are amounts users record about each other, not purchases from Festie; declare them under
Financial Info → Other Financial Info as in 2.3.

### 2.12 Usage Data — DECISION REQUIRED, recommended answer is NOT COLLECTED

| Sub-type | Recommended | Evidence |
|---|---|---|
| Product Interaction | No | The only product-interaction telemetry in the repository is the PWA install endpoint and the web-vitals beacon, and both are website-only. No file in `packages/mobile`, `packages/shared` or `public` posts to `/api/v1/analytics/install`; a repository-wide search for that path outside `routes/analytics-install.ts` and `server.ts` returns nothing |
| Advertising Data | No | No advertising SDK anywhere |
| Other Usage Data | No | — |

`packages/mobile/app.json:88-95` currently declares `NSPrivacyCollectedDataTypeProductInteraction`
with purpose Analytics. Nothing in the shipped app supports that entry, so it is an
over-declaration. See 5.9 for the decision you must make before submitting.

### 2.13 Diagnostics — COLLECTED

| Sub-type | Collected | Linked | Tracking | Purpose | Evidence |
|---|---|---|---|---|---|
| Crash Data | Yes | No, on the mobile SDK | No | App Functionality | `packages/mobile/app/_layout.tsx:63-68` passes only `dsn` and `tracesSampleRate`. No `Sentry.setUser` call exists in `packages/mobile`, `packages/web` or `packages/shared` |
| Performance Data | Yes | No, on the mobile SDK | No | App Functionality | `tracesSampleRate` defaults to 0.05, `packages/mobile/app/_layout.tsx:67` |
| Other Diagnostic Data | Yes | No, on the mobile SDK | No | App Functionality | Default Sentry breadcrumbs: console output plus fetch and XHR method, URL and status code |

**The server-side Sentry integration IS linked to the account.** `lib/sentry.ts:133` calls
`scope.setUser({ id: String(req.user.userId) })` on the error path. That id is the internal opaque
account id, never an email address, username or IP (`lib/sentry.ts:119-123`), and
`sendDefaultPii: false` is set at `lib/sentry.ts:48`. Apple's labels describe data the app collects,
which includes what the developer's server collects from app usage, so the honest answer is to mark
Crash Data as **Linked to the user**. Both SDKs are gated on a DSN environment variable; see 5.1 and
5.2 before you commit to any answer here.

**There is no diagnostics opt-out.** A search across `packages/mobile`, `packages/web`,
`packages/shared`, `lib` and `routes` for `crashReport`, `optOut`, `analyticsOptOut`, `telemetry`
and diagnostics settings found no user-facing switch. Only notification preferences exist.

### 2.14 Other Data — COLLECTED

| Item | Collected | Linked | Tracking | Purpose | Evidence |
|---|---|---|---|---|---|
| Date of birth | Yes | Yes | No | App Functionality | `migrations/058_user_date_of_birth.sql:4`; required with an 18+ check, `lib/schemas.ts:66-85`. Used for the age gate only; no other read path was found |
| Password | Yes | Yes | No | App Functionality | `migrations/004_postgresql_baseline.sql:19`; hashed with scrypt and a per-user 16-byte salt, `lib/crypto-auth.ts:20-24`. A hashed password is still collected data and must be declared |
| Device name | Yes | Yes | No | App Functionality | `packages/mobile/hooks/useMobilePush.ts:132` sends `Device.deviceName`; stored at `migrations/004_postgresql_baseline.sql:219`. It is often a personal name, such as "Sam's iPhone" |
| IP address and user agent | Yes | Yes | No | App Functionality | `migrations/004_postgresql_baseline.sql:286-296`; user agent added by `migrations/008_audit_log_enhancements.sql:5-8`. Account deletion logs username and IP at `routes/account.ts:588-591` |
| Terms acceptance record | Yes | Yes | No | App Functionality | `migrations/007_tos_and_soft_delete.sql:4-5` |
| Session and refresh tokens | Yes | Yes | No | App Functionality | `migrations/004_postgresql_baseline.sql:32-37`; stored on device in `expo-secure-store`, `packages/mobile/bootstrap.ts:18-22` |
| Battery level and low-power flag | Yes, while live sharing | Yes | No | App Functionality | Read at `packages/mobile/components/CrewLiveLocation.tsx:173-177`, relayed to crew members at `routes/socket.ts:587-589`, cached in Redis for 120 seconds with the position |

Device name, IP address and battery level are judgement calls rather than plain code facts. See 5.10.

---

## 3. Play Data safety

Google's categories differ from Apple's. Answer every question below.

### 3.1 The four questions Google asks that Apple does not

| Question | Answer | Evidence |
|---|---|---|
| Is all data encrypted in transit? | **Yes** | The mobile app's only API base is `https://festie.us/api/v1` (`packages/mobile/app/_layout.tsx:72`) and its only socket target is `https://festie.us` (`packages/mobile/hooks/useRealtimeSync.ts:116`), so Socket.IO runs over TLS. The server sets HSTS with a two-year max-age, `includeSubDomains` and `preload` whenever the public origin is HTTPS (`lib/middleware.ts:174-176`). Map tiles use `https://tile.openstreetmap.org` (`packages/shared/src/utils/mapStyle.ts:39`); the PMTiles URL is schema-forced to HTTPS (`lib/schemas.ts:406`). The FCM retry webhook, when configured, posts over HTTPS on port 443 (`lib/notifications/payload.ts:43-52`) |
| Can users request that their data be deleted? | **Yes, in the app** | `DELETE /api/v1/account/` at `routes/account.ts:543`, password-confirmed (`lib/schemas.ts:226-228`). The in-app surface is `packages/mobile/components/AccountDangerSection.tsx:30, 58-76` |
| Is there a web URL where deletion can be requested without installing the app? | **No — GAP** | `routes/pages.ts` serves only `/join/:code`, `/reset/:token`, `/reset-password`, `/privacy`, `/terms` and `/security-whitepaper`. No deletion page exists in `public/`. See 5.4 |
| Is data collection required or optional? | **Mixed — see the table** | Per-item answers below |

**What deletion does immediately** (`routes/account.ts:569-577`): stamps `deleted_at`, invalidates
all sessions, revokes all refresh tokens, deletes all device tokens, soft-deletes festival profiles
and disconnects sockets. The user row itself is only stamped. Logging in within 30 days clears
`deleted_at` and restores the account (`routes/auth.ts:315-316`).

**What the 30-day purge removes** (`migrations/060_retention_cleanup_owned_crews.sql:113-206`):
`set_ratings`, `notification_topic_subs`, `notification_preferences`, `notification_log`,
`notification_counts`, `device_tokens`, `calendar_tokens`, `festival_profiles`, `crew_poll_votes`,
`crew_polls`, `crew_meeting_points`, `crew_members`, `crew_expenses`, `crew_activity`,
`login_failures`, `email_verification_tokens`, `password_reset_tokens`, `refresh_tokens`,
`user_sessions`, `user_roles`, and finally the `users` row.

**What survives the purge.** Three things, and you must not claim otherwise:
1. `crew_member_status` rows, including a full-precision latitude and longitude. No migration
   references this table in `retention_cleanup()`. Only the admin hard-delete path removes them
   (`lib/db/stores/users.ts:244`).
2. `audit_log` rows, including IP address and user agent. They are deleted by age only, at one year
   (`migrations/060_retention_cleanup_owned_crews.sql:28-29`), never by user.
3. Crews the user created, when other members remain. Ownership transfers to the longest-standing
   remaining member (`migrations/060_retention_cleanup_owned_crews.sql:177-203`). The crew is deleted
   only if the purged user was its sole member.

**Avatar files are removed sooner than the policy says.** The orphan sweep runs every six hours
(`lib/shutdown.ts:79-104`) and builds its keep-set from `getUsers()`, which resolves to
`stores.users.readAll()` and filters `WHERE deleted_at IS NULL`
(`lib/app-context/cache.ts:52-54`, `lib/db/stores/users.ts:79`). A soft-deleted account's avatar file
is therefore erased within about six hours, not at the end of the 30-day grace period, while
`users.avatar_key` still points at it. This contradicts the in-app policy text at
`packages/mobile/app/privacy.tsx:140` and the website policy at `public/privacy.html:166`.

**A data-access mechanism exists.** `GET /api/v1/account/export` at `routes/account.ts:607` returns
a full JSON export, rate-limited to one per 24 hours.

### 3.2 Location

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| Approximate location | **Yes** | **Yes** | Optional | App functionality | SOS coordinate rounded to about 11 m, `routes/crew-sos.ts:54-57, 96-97`; shared to APNs and FCM, `routes/crew-sos.ts:243-246` |
| Precise location | **Yes** | No | Optional | App functionality | Live sharing `routes/socket.ts:597`; status breadcrumb `routes/crew-status.ts:83-93`; meeting points `routes/crew-meeting-points.ts:148` |

Location is optional in Play's sense: every capture point requires a granted foreground permission
and a deliberate user action, and live sharing is off on every launch and shown behind a duration
sheet with the copy "Only this crew can see it, only while the app is open. Off by default — it stops
when you close the app." (`packages/mobile/components/CrewLiveLocation.tsx:299-300, 317-318`).

**Do not tick "Data is processed ephemerally" for location.** It is true of the live Socket.IO relay
and false of the three persisted coordinates. Ticking it creates exactly the declared-versus-observed
mismatch that gets an app removed.

### 3.3 Personal info

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| Name | No | — | — | — | Festie never asks for a real name |
| Email address | **Yes** | **Yes, to Resend** | Optional | App functionality, account management | `migrations/009_email_and_reset_tokens.sql:4`; optional, `lib/schemas.ts:71`; `lib/email.ts:67` |
| User IDs | **Yes** | **Yes** | Required | App functionality, account management | Username, `migrations/004_postgresql_baseline.sql:18`. Shared because it appears in Resend email bodies (`lib/email.ts:67`) and in push titles (`routes/crew-sos.ts:252`) |
| Address | No | — | — | — | — |
| Phone number | No | — | — | — | — |
| Race and ethnicity | No | — | — | — | — |
| Political or religious beliefs | No | — | — | — | — |
| Sexual orientation | No | — | — | — | — |
| Other info | **Yes** | No | Required | App functionality | Date of birth, `migrations/058_user_date_of_birth.sql:4`, required at registration with an 18+ check, `lib/schemas.ts:72-85`. Also the device name, `packages/mobile/hooks/useMobilePush.ts:132` (optional; push permission gated) |

### 3.4 Financial info

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| User payment info | No | — | — | — | No card, bank or processor data is stored |
| Purchase history | No | — | — | — | No in-app purchases exist |
| Credit score | No | — | — | — | — |
| Other financial info | **Yes** | No | Optional | App functionality | Payment handles, `migrations/042_payment_handles.sql:8-10`, route `routes/account.ts:432-445`. Crew expense amounts, `migrations/020_phase3_features.sql:4-14` |

Both are optional: a user can leave the handles empty and never record an expense. No server-side
call is made to Venmo, Cash App or PayPal; the settle-up deep link is opened by the user's own
device.

### 3.5 Health and fitness — NOT COLLECTED

Neither health nor fitness data is collected. See 2.2.

### 3.6 Messages — NOT COLLECTED

| Type | Collected | Evidence |
|---|---|---|
| Emails | No | Festie sends mail; it never reads a user's mailbox |
| SMS or MMS | No | `expo-sms` opens the OS composer and never reads or sends (`packages/mobile/components/SmsHandoff.tsx:45`) |
| Other in-app messages | No | Festie has no chat. Crew free text is user-generated content, declared in 3.10 |

### 3.7 Photos and videos

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| Photos | **Yes** | No | Optional | App functionality | Avatar upload `routes/account.ts:274-293`; permission string `packages/mobile/app.json:182` |
| Videos | No | — | — | — | No video path exists |

EXIF, including any GPS tag, is stripped during processing (`lib/avatar-worker.ts:28-33`). Avatars
are stored on Festie's own disk (`lib/app-context/avatar.ts:27-41`) and uploaded to no external
service.

### 3.8 Audio files — NOT COLLECTED

`RECORD_AUDIO` is removed from the Android manifest (line 7). No microphone usage string exists in
`packages/mobile/app.json:23-26`.

### 3.9 Files and docs, Calendar, Contacts — NOT COLLECTED

- **Files and docs:** No file picker or document upload path exists. The camera is used only to scan
  a plan QR code (`packages/mobile/components/PlanQRScan.tsx:248`); no image is uploaded.
- **Calendar:** `expo-calendar` is not a dependency and no calendar permission is requested. The
  `calendar_tokens` table (`migrations/020_phase3_features.sql:30-39`) is a token for a Festie ICS
  feed the user subscribes to; it never reads the device calendar.
- **Contacts:** See 2.6.

### 3.10 App activity

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| App interactions | No | — | — | — | No product-interaction telemetry runs in the mobile app; see 2.12 |
| In-app search history | No | — | — | — | Zero matches for search-history storage |
| Installed apps | No | — | — | — | The Android `<queries>` block declares an HTTPS VIEW intent only, `AndroidManifest.xml:11-17` |
| Other user-generated content | **Yes** | No | Optional | App functionality | Crew names, totems, meeting-point labels, set notes, SOS messages, ratings and picks. Full list and citations in 2.7 |
| Other actions | No | — | — | — | — |

### 3.11 Web browsing — NOT COLLECTED

See 2.8.

### 3.12 App info and performance

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| Crash logs | **Yes** | **Yes, to Sentry** | **Required** | App functionality, diagnostics | `packages/mobile/app/_layout.tsx:63-68`; server side `lib/sentry.ts:42-58` |
| Diagnostics | **Yes** | **Yes, to Sentry** | **Required** | App functionality, diagnostics | Performance sampling at 5%, `packages/mobile/app/_layout.tsx:67`; default breadcrumbs |
| Other app performance data | No | — | — | — | — |

Mark these **required**, not optional. No user-facing opt-out exists; the SDK runs whenever its DSN
environment variable is set.

### 3.13 Device or other IDs

| Type | Collected | Shared | Required or optional | Purposes | Evidence |
|---|---|---|---|---|---|
| Device or other IDs | **Yes** | **Yes, to Google and Apple** | Optional | App functionality | Push token, `packages/mobile/hooks/useMobilePush.ts:128-133`, stored at `migrations/004_postgresql_baseline.sql:214-222`; transmitted through FCM (`lib/notifications/send.ts:452-462`) and APNs (`lib/notifications/apns.ts:25`) |

Optional because the token is only obtained after the user grants the notification permission
(`packages/mobile/hooks/useMobilePush.ts:118-127`), and the user can unregister
(`packages/mobile/hooks/useMobilePush.ts:144-150`).

No advertising identifier is collected. `com.google.android.gms.permission.AD_ID` is absent from the
manifest.

### 3.14 Tracking — NO

Answer "no data used for tracking" for every category. See the global answers in section 2.

---

## 4. Third-party SDKs and services

| Service | Where it is wired | What it receives | Why | Gated by |
|---|---|---|---|---|
| **Apple APNs** | `lib/notifications/apns.ts:25`, send path `lib/notifications/send.ts:415-440` | iOS push token, notification title containing the username, body, and — for an SOS — the coarse latitude and longitude | Push delivery | The `.p8` key; inert without it (`lib/config.ts:571-576`) |
| **Google FCM** | `lib/notifications/send.ts:32-49, 452-462` | Android push token, title containing the username, body, and — for an SOS — the coarse latitude and longitude | Push delivery | `FIREBASE_CREDENTIALS_PATH`; inert without it (`lib/notifications/send.ts:34-36`) |
| **Resend** | Client `lib/email.ts:10`, send `lib/email.ts:67` | Recipient email address, subject, and a body containing the username | Password reset, email verification, email-change notice, re-engagement | `RESEND_API_KEY`; mail is skipped entirely without it (`lib/email.ts:56-59`) |
| **Sentry (mobile)** | `packages/mobile/app/_layout.tsx:63-68` | Crash and error events, stack traces, native crashes, console and network breadcrumbs (method, URL, status code), device context | Crash and reliability diagnostics | `EXPO_PUBLIC_SENTRY_DSN`; ships inert without it |
| **Sentry (server)** | `lib/sentry.ts:42-58` | Server errors, plus the internal account id, request id, trace id, HTTP method and route pattern | Backend diagnostics | `SENTRY_DSN`, default `''` (`lib/config.ts:138`) |
| **Expo / EAS Update** | `AndroidManifest.xml:24, 26`; `packages/mobile/app.json:13-15` | An update check on every launch. Request contents are defined by Expo's protocol, not by Festie code; no Festie source attaches a user identifier | Over-the-air update delivery | Always on |
| **OpenStreetMap Foundation** | `packages/shared/src/utils/mapStyle.ts:39`; WebView allowlist `packages/mobile/components/OfflineMap.tsx:118-125` | Device IP, user agent, and the tile z/x/y of the viewport. No coordinate is placed in a URL and no account data is sent | Festival basemap | Always on when the online map is used |
| **Spotify (embed)** | `packages/mobile/app/set/[setId].tsx:571-576` | Device IP and the embedded track or artist id, only after the user taps play | Artist and track preview | User action |
| **Open-Meteo** | `routes/weather.ts:38` | The **festival venue's** stored coordinates, read at `routes/weather.ts:22-30`, sent server-to-server. No user location, no user identifier, no user IP | Festival weather | Always on |
| **Google Maps (hand-off)** | `packages/mobile/components/CrewMeetingPoints.tsx:162-171`, `CrewStatus.tsx:173` | A coordinate in a `maps.google.com` URL, opened by the user | Directions | User action |
| **FCM retry webhook** | `lib/notifications/payload.ts:40-61` | An HMAC-SHA256 hash of the device token plus the notification payload | Push retry | `FCM_RETRY_WEBHOOK_URL`, default `''`; see 5.5 |

**Not present, verified by repository-wide search:** PostHog, Amplitude, Mixpanel, Segment, Google
Analytics or gtag or GTM, Firebase Analytics, react-native-firebase, Bugsnag, Datadog, New Relic,
LogRocket, Hotjar, Microsoft Clarity, Plausible, Umami, Matomo, Fathom, AdMob, AppsFlyer, Adjust,
Branch, Facebook SDK, OneSignal.

**Not wired at this commit:** Spotify user OAuth account linking. `migrations/049_spotify_accounts.sql`
creates the table, but the only code reference is a read in the GDPR export
(`routes/account.ts:152-166`). No `lib/db/stores/spotify-accounts.ts` exists and `expo-auth-session`
has zero usages in `packages/mobile`. **Do not declare a Spotify account link on either form.** The
in-app policy declares it at `packages/mobile/app/privacy.tsx:287-294`, already marked
"[DRAFT — pending legal review]"; correct that text before public release.

**Website only, excluded from both forms:** Google Fonts (`packages/web/index.html:38, 45`). The
mobile app bundles its fonts locally (`packages/mobile/app/_layout.tsx:13-19`).

---

## 5. UNDETERMINED — check each of these before you submit

### 5.1 Is `EXPO_PUBLIC_SENTRY_DSN` set in the EAS production build profile?
All mobile Sentry collection is gated on it (`packages/mobile/app/_layout.tsx:63`). If it is unset in
the production profile, the shipped app collects no crash or diagnostic data and Diagnostics must be
answered "No" on both forms. **Check:** the EAS project's production environment variables and
`packages/mobile/eas.json`.

### 5.2 Is `SENTRY_DSN` set on the production server?
`lib/config.ts:138` defaults it to `''`. This gates the only Sentry data linked to an account id
(`lib/sentry.ts:133`). **Check:** the production server environment. If unset, Crash Data can be
declared "not linked".

### 5.3 Does the 30-day purge actually run in production?
`retention_cleanup()` is a SQL function that no application code calls. Outside `migrations/`, the
only repository reference is a test (`tests/crew-owner-hard-delete.test.ts:98`), and
`scripts/setup-crons.sh` does not schedule it. Its only scheduler is the conditional block at
`migrations/034_cleanup_and_retention.sql:108-127`, which registers a daily 03:00 UTC `pg_cron` job
**only if** the `pg_cron` extension is available, and is silently skipped otherwise. Migrations 053
and 060 both exist because earlier versions of the function aborted at runtime and left the purge
dead for long periods.
**Check, against the production database:** (1) is `pg_cron` installed; (2) does a `cron.job` row
named `retention_cleanup` exist and is it enabled; (3) did its recent runs succeed. Also check
`crontab -l` on the production host and any systemd timer.
**Until this is verified, do not tick any 30-day deletion claim on either form.** If nothing
schedules it, the honest answer is "retained until the account or the crew is deleted".

### 5.4 Play requires a public account-deletion URL
Google asks for a web URL where a user can request account deletion without installing the app. No
such page exists: `routes/pages.ts` serves only join, reset, reset-password, privacy, terms and
security-whitepaper, and `public/` contains no deletion page. **Confirm** whether one exists on
festie.us outside this repository, and create one if it does not. The form cannot be completed
correctly without it.

### 5.5 Is `FCM_RETRY_WEBHOOK_URL` set in production?
`lib/config.ts:120` defaults it to empty. If it is set, that host receives HMAC-hashed device tokens
plus notification payloads (`lib/notifications/payload.ts:40-61`) and becomes an additional
third-party recipient you must declare and name in the privacy policy. **Check:** the production
server environment.

### 5.6 Are FCM and APNs both configured in production?
FCM is inert without `FIREBASE_CREDENTIALS_PATH` (`lib/notifications/send.ts:34-36`); APNs is inert
without the `.p8` key (`lib/config.ts:571-576`). This decides whether "location shared with a third
party" is Yes or No. `public/privacy.html:282` already names Firebase Cloud Messaging as a
processor, which implies FCM is live, but that is a policy claim rather than a runtime fact.
**Check:** the production server environment.

### 5.7 Resend retention
How long Resend keeps the recipient address, subject and body is a Resend account setting and a term
of Resend's DPA, not a code fact. **Read** the Resend dashboard retention setting before answering
the third-party sharing and retention questions.

### 5.8 Sentry retention and scrubbing
Event retention, server-side data-scrubbing rules and PII storage toggles for org `festi-jn` /
project `festie` (`packages/mobile/app.json:193-196`) live in the Sentry dashboard. Both forms ask
about retention. **Read** the project settings.

Related: the exact field list uploaded by Sentry's `deviceContextIntegration`, which is enabled by
default and implemented in Sentry's native SDKs rather than in JavaScript. **Confirm against one real
event in the Sentry UI** before ticking Device ID for diagnostics on either form.

### 5.9 The `ProductInteraction` entry in the privacy manifest
`packages/mobile/app.json:88-95` declares `NSPrivacyCollectedDataTypeProductInteraction` with purpose
Analytics. No product-interaction telemetry runs in the mobile app. **Decide:** remove the manifest
entry so the manifest and the App Store form agree, or keep it and tick Product Interaction on the
form to cover Sentry's 5% performance sampling. Do not leave the manifest and the form disagreeing.
Editing `app.json` was out of scope for this read-only review.

### 5.10 Three judgement calls on data classification
- **Device name** (`packages/mobile/hooks/useMobilePush.ts:132`): often a personal name. Recommended
  answer above is Apple Other Data and Play Personal info → Other info. **Decide** and be ready to
  explain.
- **IP address and user agent** in `audit_log`: collected for security auditing only. Play exempts
  data collected solely for security and fraud prevention from disclosure; Apple has no equivalent
  general exemption. Recommended answer above is Apple Other Data, and on Play either the security
  exemption or Device or other IDs. **Decide** which reading you will stand behind.
- **Battery level and low-power flag** relayed during live sharing
  (`packages/mobile/components/CrewLiveLocation.tsx:173-177`). Recommended answer above treats them
  as part of the live-location payload rather than a separate declaration. **Decide.**

### 5.11 What EAS Update transmits on launch
`AndroidManifest.xml:24` sets `EXPO_UPDATES_CHECK_ON_LAUNCH=ALWAYS`, so the app contacts
`u.expo.dev` on every launch. The request contents are defined by Expo's update protocol, not by
Festie code. **Confirm** whether a persistent device identifier is included before finalising the
Device ID answer.

### 5.12 Play's meaning of "shared" for crew-visible fields
Username, display name, avatar and payment handles are visible in-app to other crew members
(`lib/helpers.ts:53-68`) but are not transferred to a third-party company. **Decide** which reading
Google's form intends, and answer consistently across all four fields.

### 5.13 Does any live festival point at a host other than festie.us?
`lib/schemas.ts:406` permits any HTTPS host for `offlineBasemap.pmtilesUrl` and the site-plan image.
This is database content, which was not read. An external host would see the device IP and would
become an undeclared recipient. **Check** the `map_config` of every published festival.

### 5.14 Is Cloudflare Web Analytics injected at the edge?
`lib/helpers.ts:103` allowlists `https://static.cloudflareinsights.com` in the CSP, but no Festie
source injects that script. Only the Cloudflare edge could. This affects the website, not the store
apps, but it belongs in the privacy policy. **Check** the Cloudflare dashboard; if it is vestigial,
remove the CSP entry.

### 5.15 Coarse versus precise location on the Apple form
Apple's privacy manifest has no coarse-location type distinct from
`NSPrivacyCollectedDataTypePreciseLocation`, so the existing entry at `packages/mobile/app.json:31-39`
already covers the SOS coordinate at the manifest level. On the App Store Connect form itself, tick
**both** Precise Location and Coarse Location. **Confirm** this is accepted when you fill the form.

### 5.16 Policy text that disagrees with the code — fix before public release
These are not form answers, but both stores compare the declaration, the policy and the observed
behaviour. Each is a live mismatch.
- **The SOS coordinate is absent from the privacy policy.** `public/privacy.html:126` documents only
  the status breadcrumb and the meeting-point coordinates. It does not mention the coarse coordinate
  stored in `crew_activity.detail` or the copy in `notification_log.data_json`.
- **Avatar retention is overstated.** `packages/mobile/app/privacy.tsx:140` and
  `public/privacy.html:166` promise deletion after the 30-day grace period; the six-hourly orphan
  sweep erases the file within about six hours of soft-deletion (`lib/shutdown.ts:79-104`,
  `lib/db/stores/users.ts:79`). An account reactivated inside the window points at a missing file.
- **`crew_member_status` is not covered by the purge.** A soft-deleted user's full-precision
  coordinates can outlive the automated 30-day purge. **Decide:** fix the purge before public
  release, or declare the longer retention.
- **Open-Meteo is not named** in the sub-processor list at `packages/mobile/app/privacy.tsx`. It needs
  no store-form declaration, but the policy should name it.
- **No SOS screen tells the user the coordinate is stored durably** in the crew activity feed.
  `packages/mobile/components/CrewSos.tsx` explains the alert, not the retention. Consider adding one
  line of copy before public release.

---

## 6. Provenance

- **Commit read:** `6c05142505b48f2427fdac7dab5f1773ed6cc94f`, dated 2026-09-09.
- **Working tree at the time of review:** `server.ts` had uncommitted local modifications. Nothing in
  those modifications was relied on for any answer above, but re-check it if the file has changed.
- **Draft written:** 2026-09-09.
- **Review method:** read-only inspection of source, migrations and configuration on disk. No
  database was queried, no environment file was read, and no store console was contacted.
- **Re-verify before you submit.** The code moves. Every citation above is a file and a line at one
  commit. Before you type these answers into either console, diff the repository against
  `6c05142505b48f2427fdac7dab5f1773ed6cc94f` and re-read any cited file that changed. Re-check every
  item in section 5, because those answers live outside the repository and can change without a
  commit.

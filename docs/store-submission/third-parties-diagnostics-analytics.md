# Third parties, diagnostics and analytics — evidence inventory

**Purpose.** This file answers the SDK and third-party questions on the App Store privacy labels
and the Google Play Data-safety form. Every claim cites a file and line at HEAD.

**Status.** DRAFT for the owner to transcribe. Nothing here was submitted anywhere.

**Method.** I read the four `package.json` files, then traced each dependency to a call site.
A dependency that is installed but never called is marked NOT WIRED and must not be declared.
Where the code does not settle a question, the answer is `UNDETERMINED` and names the check.

**Scope note.** The two forms cover the iOS and Android apps. Web-only paths are marked
`(web only)` and do not belong on either form.

---

## 1. Verdict table

| Service | Wired? | Where the evidence is | Data that reaches it | Linked to identity |
|---|---|---|---|---|
| Sentry (Functional Software) | YES — server, web, mobile | `lib/sentry.ts:42`, `packages/web/src/main.tsx:21`, `packages/mobile/app/_layout.tsx:64` | Errors, stack traces, breadcrumbs, device context | Server: opaque user id. Mobile/web: no user id set |
| Firebase Cloud Messaging (Google) | YES — server sends, Android device registers | `lib/notifications/send.ts:38`, `packages/mobile/app.json` `googleServicesFile` | Device token, notification title/body/data | Yes — token maps to one account |
| Apple Push Notification service | YES — direct HTTP/2, iOS | `lib/notifications/apns.ts`, `lib/notifications/send.ts:17` | APNs token, alert payload | Yes — token maps to one account |
| Resend (transactional email) | YES | `lib/email.ts:4,67` | Recipient address, username, message body | Yes — email address |
| OpenStreetMap tile server | YES — map basemap | `packages/shared/src/utils/mapStyle.ts:39` | Tile coordinates, device IP, User-Agent | No account data; see §5 |
| Expo / EAS Update (Expo Inc.) | YES — checks on every launch | `AndroidManifest.xml:24,26`, `app.json` `updates.url` | Platform, runtime version, channel | UNDETERMINED — see §9 |
| Spotify (embedded player) | YES — on user tap | `packages/mobile/app/set/[setId].tsx:576` | Device IP, the track or artist id opened | No account data |
| Spotify Web API (server-side) | YES — admin lineup import | `lib/spotify.ts:11,12` | Artist names only, no user data | No |
| Open-Meteo (weather) | YES — server-side | `routes/weather.ts:38` | Festival coordinates only | No |
| PostHog | **NOT PRESENT** | Zero matches repo-wide | — | — |
| Any advertising or attribution SDK | **NOT PRESENT** | Zero matches repo-wide | — | — |
| Spotify user OAuth (account linking) | **NOT WIRED** | Table exists, no writer — see §8 | — | — |

---

## 2. Sentry — exact configuration

Sentry is the only crash and error reporting service. Three separate SDKs are initialised.
Each is disabled unless its DSN environment variable is set.

### 2a. Server — `lib/sentry.ts`

Initialisation, lines 42-58:

```
Sentry.init({
  dsn,
  environment: options.environment || _cfg.NODE_ENV || 'production',
  release: options.release || _cfg.APP_VERSION || 'dev',
  tracesSampleRate: Number(_cfg.SENTRY_TRACES_RATE ?? 0.05),
  profilesSampleRate: Number(_cfg.SENTRY_PROFILES_RATE ?? 0),
  sendDefaultPii: false,
  beforeSend(event: any) {
    // Strip obvious PII paths
    if (event.request && event.request.headers) {
      delete event.request.headers.cookie;
      delete event.request.headers.authorization;
    }
    return event;
  },
  ...options.extra,
});
```

**Redacted:** the `cookie` and `authorization` request headers, deleted before send.
`sendDefaultPii: false` is set explicitly.

**Sent deliberately.** The error handler attaches exactly five values, `lib/sentry.ts:130-141`:

```
const scope = Sentry.getIsolationScope();
if (req?.user?.userId) scope.setUser({ id: String(req.user.userId) });
if (req?.id) scope.setTag('requestId', req.id);
if (req?.traceId) scope.setTag('traceId', req.traceId);
if (req?.method) scope.setTag('method', req.method);
const routePath = req?.route?.path ? `${req.baseUrl || ''}${req.route.path}` : undefined;
if (routePath) scope.setTag('route', routePath);
```

The comment above it, lines 119-123, states the intent: "an opaque user id (never
email/username/IP), the request id + trace id, the route PATTERN (req.route.path — not the raw
URL, which may contain ids), and the HTTP method."

So the server sends: **error message and stack trace, the account's internal user id, a request
id, a trace id, the HTTP method, and the route pattern.** The user id makes server events
**linked to identity**. Sampling: 5% of transactions by default (`SENTRY_TRACES_RATE`),
profiling off by default (`SENTRY_PROFILES_RATE` default 0, `lib/config.ts:139-140`).

`sentry.setUser` is exported (`lib/sentry.ts:81`) but no route or library calls it; the only
user attribution is the error-handler block above.

### 2b. Mobile — `packages/mobile/app/_layout.tsx:63-69`

```
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN && !isExpoGo) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_RATE ?? 0.05),
  });
}
```

`Sentry.wrap(RootLayout)` is applied at line 490.

**There is no `beforeSend`, no `beforeBreadcrumb`, and no scrubbing on mobile.** Everything below
follows from SDK defaults, which I read in the installed package
(`@sentry/react-native` 7.11.0).

**IP address — not stored.** `sendDefaultPii` is left unset, so it is falsy. The client sets the
Relay instruction directly, `dist/js/client.js:29-30`:

```
// Only allow IP inferral by Relay if sendDefaultPii is true
infer_ip: options.sendDefaultPii ? 'auto' : 'never'
```

The device IP is therefore not inferred into the event. Sentry's ingest endpoint still sees the
IP at the network layer, as any HTTPS server does; it is not recorded as event data.

**Verified default options** (`dist/js/sdk.js:27-44`):

| Option | Value | Meaning |
|---|---|---|
| `attachStacktrace` | `true` | Stack traces attached |
| `enableNativeCrashHandling` | `true` | Native crashes captured |
| `enableUserInteractionTracing` | `false` | Touch targets NOT tracked |
| `enableCaptureFailedRequests` | `false` | Failed HTTP requests NOT captured |
| `enableWatchdogTerminationTracking` | `true` | iOS hangs captured |
| `enableAppStartTracking`, `enableNativeFramesTracking`, `enableStallTracking` | `true` | Startup and frame timing |

**Verified default integrations** (`dist/js/integrations/default.js:15-105`): error handlers,
`breadcrumbsIntegration`, `dedupeIntegration`, `httpContextIntegration`,
`deviceContextIntegration`, `modulesLoaderIntegration`, `expoContextIntegration`, plus app-start
and frame timing. **Not enabled:** `screenshotIntegration` (needs `attachScreenshot`),
`viewHierarchyIntegration` (needs `attachViewHierarchy`), `hermesProfilingIntegration` (needs
`profilesSampleRate`), `mobileReplayIntegration` (needs a replay sample rate). Festie sets none
of those four options, so **no screenshots, no view hierarchy, no profiling, no session replay.**

**Breadcrumbs.** `breadcrumbsIntegration()` is created with no arguments, so its defaults apply
(`@sentry/browser/.../integrations/breadcrumbs.js:13-18`): `console: true, dom: true,
fetch: true, history: true, sentry: true, xhr: true`. A fetch or XHR breadcrumb records
`method`, `url` and `status_code` (same file, lines 190-195 and 240-241) — **the request URL,
not the request body.** Festie's API calls go to `https://festie.us/api/v1`
(`packages/mobile/app/_layout.tsx:73`), so breadcrumb URLs contain Festie path segments such as
festival and crew ids. Console breadcrumbs capture whatever the app logs to `console`.

**User identity on mobile: none.** No `Sentry.setUser` call exists anywhere in the mobile or web
packages. The only other mobile Sentry call is one error capture,
`packages/mobile/hooks/useMobilePush.ts:110`.

### 2c. Web (web only) — `packages/web/src/main.tsx:20-29`

```
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION || 'dev',
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_RATE ?? 0.05),
    sendDefaultPii: false,
    integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
  });
}
```

`sendDefaultPii: false` is explicit. No `beforeSend`. Breadcrumb defaults are the same as
above, and `history: true` records URL changes — the web app has a `?joinCrew=<inviteCode>`
deep link (`packages/web/src/hooks/useFestivalLoader.ts:84`), so a crew invite code can appear
in a web breadcrumb. This is web only; the app's password-reset token link
(`?token=…`) resolves to a **mobile** screen, not a web route
(`packages/mobile/app/reset-password.tsx:20`; `packages/web/src/routes/` has no
reset-password route), so no reset token reaches Sentry from the store apps.

---

## 3. PostHog and analytics — verified absent

I searched the whole repository, excluding `node_modules`, `.git`, `coverage`, `dist` and
`output`:

- `posthog` — **zero matches, in any file, in any case.**
- `amplitude`, `mixpanel`, `segment.com`, `google-analytics`, `gtag`, `googletagmanager`,
  `firebase/analytics`, `@react-native-firebase`, `appsflyer`, `adjust.com`, `branch.io`,
  `fbsdk`, `admob`, `onesignal`, `bugsnag`, `datadog`, `newrelic`, `logrocket`, `hotjar`,
  `clarity.ms`, `plausible`, `umami`, `matomo`, `fathom` — **zero product matches.** The only
  hits are the English word "plausible" in prose, the string `'facebook'` as a social-link label
  in `lib/constants.ts:18`, and design-research documents citing LogRocket blog articles.

**The previous audit was right: there is no PostHog code at HEAD, and no analytics SDK of any
vendor.**

Festie does collect two kinds of product telemetry, both **first-party** — they post to
Festie's own server and no third party is involved:

1. **Install-funnel events (web only).** `routes/analytics-install.ts:25-59`. Accepts
   `platform`, `event`, `reason`, `engagement_ms`, plus the User-Agent string, and inserts a row
   into `install_events`. No auth, **no user id, no IP stored** — the IP is used only by the rate
   limiter.
2. **Web-vitals beacons (web only).** `packages/web/src/lib/web-vitals.ts:75-84` posts metric
   name, value, rating, delta, id, `window.location.pathname` and navigation type to
   `/api/v1/metrics/web-vitals`. The server records only a Prometheus histogram with the labels
   `metric` and `nav` (`routes/client-metrics.ts:55-62`). The URL is not stored. Nothing is
   attributed to a user.

Server metrics are exposed on a loopback-only Prometheus listener
(`lib/metrics.ts:288-290`: "Only binds to 127.0.0.1") and, for the admin dashboard, behind
`adminAuth` (`routes/admin-metrics.ts:33`).

---

## 4. Push notification providers — what leaves the server

**Firebase Cloud Messaging.** Loaded only when credentials are configured,
`lib/notifications/send.ts:33-46`. The message built for each device,
`lib/notifications/send.ts:210-236`, carries `notification: { title, body }` and
`data: { type, ...data }`.

**Apple Push Notification service.** iOS device tokens go direct to Apple over HTTP/2
(`lib/notifications/apns.ts`), not through FCM. Endpoints `api.push.apple.com` and
`api.sandbox.push.apple.com`.

**What the payloads contain.** These are real examples, not hypotheticals:

- Crew pick update — `lib/emitter.ts:97`: title "Crew Update", body
  `` `${profile.name} updated their picks` `` — **a crew member's display name.**
- Schedule change — `lib/emitter.ts:143`: title "Schedule Updated", body the festival name.
- **SOS — `routes/crew-sos.ts:242-252` puts precise coordinates in the push payload:**

```
const data: Record<string, any> = { crewId, userId: raiserId, deepLink: `rave://crew/${crewId}/sos` };
if (position) {
  data.lat = String(position.lat);
  data.lng = String(position.lng);
}
```

  with title `` `${username} raised an SOS` ``.

**Declare this.** When a user raises an SOS with a position attached, their **precise latitude
and longitude, their username and their user id transit Google's and Apple's push
infrastructure**, addressed to a device token that identifies one account. This is location data
shared with a third party, linked to identity. It is app functionality, not analytics or
advertising.

**Device token registration** is first-party: `packages/mobile/hooks/useMobilePush.ts:129-135`
sends `token`, `platform` and `Device.deviceName` to Festie's own API. The app uses
`getDevicePushTokenAsync` (the native FCM or APNs token), **not** Expo's push relay — so
notification content does not pass through Expo's servers.

**Optional retry webhook.** `lib/notifications/payload.ts:40-61` posts an HMAC-hashed token plus
the payload to `FCM_RETRY_WEBHOOK_URL`. That variable defaults to empty
(`lib/config.ts:120`). If the owner has set it in production, its host is a further recipient.
See §9.

---

## 5. Map tiles — hosts and what a request reveals

**Two basemap paths**, chosen by `pickMapStyle`, `packages/shared/src/utils/mapStyle.ts:133-140`.

**Path A — online raster, the default.** `packages/shared/src/utils/mapStyle.ts:39`:

```
tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
```

The tile host is `tile.openstreetmap.org`, run by the OpenStreetMap Foundation. No API key, no
account. On native, the map runs inside a WebView whose origin allowlist is exactly
(`packages/mobile/components/OfflineMap.tsx:121-125`):

```
const MAP_ORIGIN_WHITELIST = [
  'about:',
  'https://tile.openstreetmap.org',
  'https://*.tile.openstreetmap.org',
];
```

The MapLibre runtime is **vendored into the app bundle**, so the map loads no CDN script
(`packages/mobile/lib/mapDocument.ts:14-20`; the former `unpkg.com` dependency is gone and a
test asserts it stays gone, `packages/mobile/lib/webviewBridge.test.ts:91`).

**Can a tile request carry user data or a precise position? Answer for the form: yes, indirectly,
and here is the precise boundary.**

- A tile request carries **no account data**: no user id, no token, no cookie. It carries the
  tile's z/x/y coordinates, the device IP address and the WebView User-Agent.
- **The map does not open on the user's GPS position.** The initial camera comes from the
  festival's map config, its pins, or their centroid — `packages/mobile/components/OfflineMap.tsx:334`
  ("Initial camera: festival map-config (bounds/center) → static pins → centroid"). Opening the
  map therefore reveals only which festival the user is looking at.
- **The "find me" control does move the viewport onto the user's real position.**
  `packages/mobile/components/OfflineMap.tsx:951-965` calls
  `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })` and flies the map to
  those coordinates at zoom 16. The tiles then fetched are the tiles around the user. At zoom 16
  a tile covers a few hundred metres, so OpenStreetMap can infer the user's approximate location
  from the requested tiles plus the IP. Festie sends no coordinate field; the inference comes
  from which tiles are requested.
- Coordinates are **never** placed in a tile URL. The `{z}/{x}/{y}` template is the only
  substitution.

**Path B — offline PMTiles archive.** A festival may carry
`mapConfig.offlineBasemap.pmtilesUrl`, validated as https at
`lib/schemas.ts:406`. It is read through the `pmtiles://` protocol
(`packages/shared/src/utils/mapStyle.ts:74`). The app resolves it through Festie's own stable
endpoint `GET /festivals/:id/basemap`, which 302-redirects to the archive
(`routes/festivals.ts:157-190`). The generator script writes archives to Festie's own
`/uploads/basemaps/<festivalId>.pmtiles` (`scripts/gen-festival-pmtiles.mjs:53`), so the normal
case is first-party hosting. **The schema permits any https host**, and when a remote archive is
in use the WebView allowlist is widened by exactly that one host
(`packages/mobile/components/OfflineMap.tsx:615-620`). Once the archive is cached on device the
map reads from `file://` and makes **no network request at all**
(`packages/mobile/components/OfflineMap.tsx:577-580`).

**Site plan images.** A festival may also carry a site-plan raster on an external https host,
allowlisted the same way (`packages/mobile/components/OfflineMap.tsx:581-593`). Same disclosure
shape as PMTiles: the image host sees the device IP.

**Owner check required:** whether any live festival's `pmtilesUrl` or site-plan `imageUrl` points
off `festie.us`. That is database content, which this audit did not read. See §9.

---

## 6. Crash and performance diagnostics — collected, linked, opt-out

**What is collected on the store apps:**

| Item | Collected | Linked to identity | Evidence |
|---|---|---|---|
| Crash reports, native crashes, JS errors, stack traces | Yes, when the DSN is set | **No** — no `setUser` on mobile | `_layout.tsx:64`; `attachStacktrace: true` |
| Breadcrumbs: console output, API request URLs and status codes | Yes | No | breadcrumbs defaults, §2b |
| Device context: model, OS version, and similar | Yes | No | `deviceContextIntegration` enabled |
| App start time, frame timing, stalls | Yes, 5% transaction sample | No | `tracesSampleRate` 0.05 |
| Device IP address | **Not recorded** | — | `infer_ip: 'never'`, §2b |
| Screenshots, view hierarchy, session replay, profiling | **No** | — | integrations not enabled, §2b |
| Server-side errors | Yes | **Yes — opaque user id** | `lib/sentry.ts:133` |

**Can the user opt out? No.** I searched the mobile, web and shared packages and the server for
`crashReport`, `optOut`, `telemetry`, `analyticsOptOut` and `diagnostics` settings. **There is no
user-facing switch to disable crash reporting.** The only controls that exist are notification
preferences. Both forms ask whether collection is optional: the honest answer for diagnostics is
**required, not optional**.

Sentry runs only when the DSN environment variable is set
(`lib/sentry.ts:22-28`, `main.tsx:20`, `_layout.tsx:64`), and it is skipped entirely in Expo Go
(`_layout.tsx:53`). **Owner check: confirm `EXPO_PUBLIC_SENTRY_DSN` is actually set in the EAS
production build profile.** If it is not set, the shipped app collects no crash data at all and
the label must say so. See §9.

---

## 7. Advertising and tracking SDKs — verified absent

This is a negative finding, and it is evidenced.

- **No advertising SDK.** Searches for `admob`, `gms.ads`, `appsflyer`, `adjust`, `branch.io`,
  `fbsdk`, `onesignal` return zero matches outside lockfiles.
- **No advertising identifier.** Searches for `IDFA`, `advertisingId`, `AdvertisingIdClient`,
  `AppTrackingTransparency`, `expo-tracking-transparency` and `NSUserTrackingUsageDescription`
  return **zero matches repo-wide.**
- **The Android manifest requests no ad permission.**
  `packages/mobile/android/app/src/main/AndroidManifest.xml:2-10` lists exactly:
  `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `CAMERA`, `INTERNET`,
  `READ_EXTERNAL_STORAGE` (maxSdk 32), `VIBRATE`, `WRITE_EXTERNAL_STORAGE` (maxSdk 32).
  `com.google.android.gms.permission.AD_ID` is **absent**. `RECORD_AUDIO` and
  `SYSTEM_ALERT_WINDOW` are explicitly removed (lines 7-8, matching `app.json`
  `blockedPermissions`).
- **The iOS privacy manifest already declares no tracking:** `app.json` sets
  `"NSPrivacyTracking": false` with an empty `NSPrivacyTrackingDomains`.

**Form answer: no data is used for tracking, and no third-party advertising or analytics SDK is
present.** This is safe to state.

---

## 8. Mismatches with what Festie already declares — fix before submitting

Three existing declarations do not match the code. Each one is the kind of mismatch a store
reviewer can act on.

**8a. The iOS privacy manifest declares Product Interaction for Analytics, and no analytics
exists.** `packages/mobile/app.json` contains:

```
"NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeProductInteraction",
"NSPrivacyCollectedDataTypeLinked": false,
"NSPrivacyCollectedDataTypeTracking": false,
"NSPrivacyCollectedDataTypePurposes": ["NSPrivacyCollectedDataTypePurposeAnalytics"]
```

The only product-interaction telemetry in the codebase is the install-funnel endpoint and the
web-vitals beacon, and **both are web only** (§3) — neither runs in the iOS app. **This looks
like an over-declaration.** Over-declaring is also a defect: it forces a label that the app's
behaviour does not support. The owner should decide whether to remove this entry or keep it to
cover Sentry's performance sampling. Changing `app.json` is a source edit and out of scope for
this read-only audit.

**8b. The in-app privacy policy declares a Spotify user-OAuth account link that is not wired.**
`packages/mobile/app/privacy.tsx:288-294` states Festie retains "an encrypted refresh token and
Spotify user ID". At HEAD:

- The table exists — `migrations/049_spotify_accounts.sql` creates `spotify_accounts`.
- **Nothing writes it.** The only reference in `routes/` or `lib/` is a read in the GDPR export
  path, `routes/account.ts:152-166`.
- The store module the migration names, `lib/db/stores/spotify-accounts.ts`, **does not exist**.
- `expo-auth-session` is in `packages/mobile/package.json` but has **zero usages** in the app.

Server-side Spotify is client-credentials only — "No user OAuth required",
`lib/spotify.ts:5-9`. **Do not declare a Spotify account link on either form.** The policy text
is marked "[DRAFT — pending legal review]" and should be corrected before public release.

**8c. Open-Meteo is not named in the privacy policy.** `routes/weather.ts:38` calls
`https://api.open-meteo.com/v1/forecast`. It sends only the **festival's** stored coordinates
(`routes/weather.ts:22-30`), never the user's, and the call is server-to-server, so the user's
IP never reaches Open-Meteo. It needs no store-form declaration, but the sub-processor list in
`privacy.tsx` should name it for accuracy.

---

## 9. UNDETERMINED — the owner must check these

Each of these changes an answer on a form, and none can be settled from source.

1. **Is `EXPO_PUBLIC_SENTRY_DSN` set in the EAS production build?** Check the EAS project's
   `production` environment variables. If unset, the shipped app collects no diagnostics and §6
   must be answered "not collected".
2. **Is `SENTRY_DSN` set on the production server?** Same question for server-side error data,
   which is the only Sentry data linked to a user id.
3. **Is `FCM_RETRY_WEBHOOK_URL` set in production?** `lib/config.ts:120` defaults it to empty.
   If it is set, its host receives hashed device tokens plus notification payloads and is a
   further recipient.
4. **Does any live festival use an off-`festie.us` PMTiles or site-plan host?** Read
   `map_config` from the festivals table. Festie's own generator writes to `festie.us`, but the
   schema allows any https host.
5. **Is festie.us behind Cloudflare, and is Cloudflare Web Analytics enabled?**
   `lib/helpers.ts:103` allows `https://static.cloudflareinsights.com` in the CSP, but **no
   Festie source file injects that script** — it would be injected by the Cloudflare edge, not
   by the app. If the edge injects it, a Cloudflare analytics beacon runs on the **website**
   (web only, not the store apps) and must appear in the privacy policy. If the CSP entry is
   vestigial, it should be removed.
6. **Sentry's own project settings.** The scrubbing in §2 is what the client sends. Sentry's
   server-side data-scrubbing settings, retention period and PII-storage toggles are configured
   in the Sentry dashboard for org `festi-jn`, project `festie` (`app.json`, Sentry plugin
   block). Both forms ask about retention. Retention is not in this repository.
7. **What device fields `deviceContextIntegration` actually uploads.** The integration is
   enabled by default and is implemented in Sentry's native SDKs, not in JavaScript. Confirm the
   field list against one real event in the Sentry UI before ticking Device ID on a form.
8. **What EAS Update sends on launch.** `AndroidManifest.xml:24` sets
   `EXPO_UPDATES_CHECK_ON_LAUNCH = ALWAYS` and line 26 sets the update URL to
   `https://u.expo.dev/ed47ea14-…`, so **the app contacts Expo's servers on every launch**. The
   request contents are defined by Expo's update protocol, not by Festie's code, so this audit
   cannot state whether a persistent device identifier is included. Confirm against Expo's
   documentation before answering Device ID.

---

## 10. Items that are not SDK collection, but hand data to a third party

List these knowingly. They are user-initiated hand-offs, not background collection, and neither
form treats them as developer collection. Note them so an answer stays defensible if questioned.

- **"Open in Google Maps".** Tapping a crew member's location or a meeting point opens
  `https://maps.google.com/?q=<lat>,<lng>` in the OS browser or maps app —
  `packages/mobile/components/CrewStatus.tsx:173`,
  `packages/mobile/components/CrewMeetingPoints.tsx:172`. Google receives those coordinates
  because the user chose to open them there.
- **Spotify embedded player.** Tapping "play preview" loads
  `https://open.spotify.com/embed/...` in a WebView —
  `packages/mobile/app/set/[setId].tsx:571-576`, embed URL built at `routes/spotify.ts:31,44`.
  Spotify sees the device IP and which artist or track was opened. The WebView is default-deny:
  only Spotify hosts load in-frame, and any click navigates out to the OS
  (`packages/mobile/app/set/[setId].tsx:577-595`).
- **SMS hand-off.** `packages/mobile/components/SmsHandoff.tsx:45` composes a message containing
  a meeting-point maps link and hands it to the OS messaging app. Festie sends nothing itself.
- **Encrypted off-site backups.** `scripts/backup-offsite-git.sh` encrypts a Postgres dump with
  GPG AES-256 (lines 114-120) and pushes the ciphertext to a private GitHub repository
  (line 66). This is infrastructure processing, not in-app collection. GitHub receives only
  ciphertext.
- **Google Fonts.** The **website** loads font CSS from `fonts.googleapis.com`
  (`packages/web/index.html:38,45`) — web only. **The mobile app does not:**
  `@expo-google-fonts/syncopate` and `@expo-google-fonts/space-grotesk` ship the font files
  inside the app bundle and are loaded with `useFonts`
  (`packages/mobile/app/_layout.tsx:13-19,175`). No font request leaves the store apps.

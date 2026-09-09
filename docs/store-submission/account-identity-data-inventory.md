# Account and identity data — store-declaration inventory

Scope: account and identity data only. Location, photos, push tokens, diagnostics
and third-party SDKs are inventoried separately.

Source of truth: `migrations/*.sql` on disk and the route/library files cited.
No database was queried. Every claim below names a file and line. Anything the
code does not establish is marked **UNDETERMINED** with the exact check the owner
must run.

App Store label vocabulary used here: "Contact Info", "User Content",
"Identifiers", "Financial Info". Play Data-safety vocabulary used here:
"Personal info", "Financial info", "App activity", "Photos".

---

## 1. Summary table

| Field | Collected | Stored where | Linked to identity | Sent to third party | Purpose |
|---|---|---|---|---|---|
| Username (`@handle`) | Yes, required | `users.username` (migration 004, line 18) | Yes | Yes — Resend, APNs, FCM | Login identity, display in crews |
| Password | Yes, required | `users.password_hash` (migration 004, line 19) | Yes | No | Authentication |
| Email address | Optional | `users.email` (migration 009, line 4) | Yes | Yes — Resend | Verification, password reset, re-engagement mail |
| Date of birth | Yes, required | `users.date_of_birth` (migration 058, line 4) | Yes | No | 18+ age gate |
| Display name | Optional | `users.display_name` (migration 041, line 6) | Yes | No (not verified in push payloads) | Friendly name in crews |
| Avatar image | Optional | File on server disk + `users.avatar_key` (migration 004, lines 20-22) | Yes | No | Profile picture |
| Payment handles (Venmo, Cash App, PayPal) | Optional | `users.venmo_handle`, `cashapp_cashtag`, `paypal_handle` (migration 042) | Yes | No server-side send; the app builds a deep link the user opens | Settle-up links |
| Terms acceptance | Yes, automatic | `users.tos_accepted_at`, `tos_version` (migration 007) | Yes | No | Legal record |
| Set notes (free text) | Optional | `festival_profiles.notes_json` (migration 004, line 113), `festival_profile_notes.text` (migration 004, line 140) | Yes | No | Personal schedule notes |
| Crew name and totem (free text) | Optional | `crews.name` (migration 004, line 160); `crews.totem_name`, `totem_emoji` (migration 056) | Yes, to the creator | No | Crew identification |
| Meeting-point label and location text | Optional | `crew_meeting_points.label`, `.location` (migration 017, lines 8-9) | Yes, through `created_by` | No | Regroup points |
| Crew status note (free text) | Optional | `crew_member_status.note` (migration 051, line 22) | Yes | No | "On my way" note |
| IP address | Yes, in logs and audit rows | `audit_log.ip` (migration 004); PM2 log files | Yes | No | Security auditing |

---

## 2. Field detail

### 2.1 Username

- **What.** The immutable `@handle`. Required at registration, 2 to 30 characters.
  Validation: `lib/schemas.ts:68` (`registerSchema`) and `routes/auth.ts:168-171`.
- **Stored.** `users.username CITEXT NOT NULL UNIQUE` — `migrations/004_postgresql_baseline.sql:18`.
  Written at `lib/db/stores/users.ts:179`.
- **Also copied into.** `user_sessions.username` (migration 004, line 35).
- **Used for.** Login lookup (`routes/auth.ts:259`), display when `display_name` is
  unset (`lib/helpers.ts:58`), and the default festival-profile name
  (`routes/profiles.ts:96`).
- **Linked to identity.** Yes. It is the account identifier.
- **Third party.** Yes, two paths:
  1. Transactional email bodies sent through Resend. `routes/auth.ts:60` passes
     `username` to `sendVerificationEmail`; the send call is `lib/email.ts:66`.
  2. Push notification titles delivered by Apple APNs and Google FCM. Example:
     `routes/crew-sos.ts:252` sets `title: \`${username} raised an SOS\``.
- **Deleted by.** `DELETE FROM users` in `retention_cleanup()`
  (`migrations/060_retention_cleanup_owned_crews.sql:206`), or the admin hard delete
  at `lib/db/stores/users.ts:281`. See section 3.

The user cannot change their own username. Only admin tooling renames — see the
comment at `routes/account.ts:345-347`.

### 2.2 Password

Declare this as collected on both forms. Hashing does not remove it from the
"collected data" question; it only supports the security answer.

- **What.** A password chosen at registration. Policy enforced by
  `checkPasswordPolicy` (`routes/auth.ts:172`).
- **Hashing.** Node's `crypto.scrypt`, 16 random bytes of salt per user, 64-byte
  derived key, stored as `salt:hash` hex. `lib/crypto-auth.ts:20-24`:

  ```ts
  export async function hashPassword(password: any) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = ((await scryptAsync(password, salt)) as Buffer).toString('hex');
    return `${salt}:${hash}`;
  }
  ```

  Comparison is constant-time (`crypto.timingSafeEqual`, `lib/crypto-auth.ts:35`).
  The scrypt cost parameters are Node's defaults; the code passes no `N`, `r` or `p`.
- **Stored.** `users.password_hash TEXT` — `migrations/004_postgresql_baseline.sql:19`.
- **Plaintext.** Never stored. It exists only in the request body and the hashing
  call.
- **Third party.** No. No code path sends the password or the hash anywhere.
- **Deleted by.** The `users` row delete. See section 3.

### 2.3 Email address

- **What.** Optional at registration (`lib/schemas.ts:71`, `email: email.optional()`).
  Required if the user wants password reset or verification mail.
- **Stored.** `users.email TEXT` — `migrations/009_email_and_reset_tokens.sql:4`.
  A unique index on `LOWER(email)` applies only to live rows
  (`migrations/009_email_and_reset_tokens.sql:6`, `WHERE email IS NOT NULL AND deleted_at IS NULL`).
- **Also stored.** `email_verification_tokens.email` holds a pending address until
  the user clicks the link (`migrations/009_email_and_reset_tokens.sql:19-27`). A
  requested new address is written only to this table, never to `users`, until the
  link is opened — see the comment at `routes/account.ts:454-460`.
- **Used for.** Verification (`routes/auth.ts:53-60`), password reset
  (`routes/email-auth.ts:110-120`), email-change security notice
  (`routes/account.ts:530`), and re-engagement mail
  (`lib/notifications/reengagement.ts:232`).
- **Linked to identity.** Yes.
- **Third party.** Yes. All mail is sent through Resend, a third-party email
  provider. The client is created at `lib/email.ts:10` and the send is
  `lib/email.ts:66`: `client.emails.send({ from, to: [to], subject, html, text })`.
  Resend therefore receives the address, the subject, and the body, which contains
  the username. Mail is skipped entirely when `RESEND_API_KEY` is unset
  (`lib/email.ts:56-59`).
- **Deleted by.** `DELETE FROM users` and
  `DELETE FROM email_verification_tokens` in `retention_cleanup()`
  (`migrations/060_retention_cleanup_owned_crews.sql:157-159, 206`).

**UNDETERMINED — Resend log retention.** How long Resend keeps the recipient
address and message body is a Resend account setting, not a code fact. The owner
must read the Resend dashboard retention setting and the Resend data-processing
terms before answering "data shared with third parties" on either form.

### 2.4 Date of birth

- **What.** Required at registration. Format `YYYY-MM-DD`, with an 18+ refinement:
  `lib/schemas.ts:72-85`.
- **Stored.** `users.date_of_birth DATE` — `migrations/058_user_date_of_birth.sql:4`.
  Written at `lib/db/stores/users.ts:179`.
- **Used for.** The 18+ age gate only. No other read path was found.
- **Linked to identity.** Yes.
- **Third party.** No.
- **Deleted by.** The `users` row delete. See section 3.

This is the field most likely to change the store answers. Both forms treat date
of birth as sensitive personal information, and an app that collects it must say so.

### 2.5 Display name

- **What.** Optional, user-editable, 1 to 50 characters (`lib/schemas.ts:205-207`).
- **Stored.** `users.display_name TEXT` — `migrations/041_user_display_name.sql:6`.
- **Set by.** `PUT`/`PATCH /api/v1/account/display-name` — `routes/account.ts:372-385`.
  Input is passed through `sanitizeString(displayName, 50)` at `routes/account.ts:353`.
- **Returned as.** `name` in the public user object (`lib/helpers.ts:58`). Null
  falls back to the username in clients.
- **Linked to identity.** Yes.
- **Third party.** Not established. Push titles found in this review use
  `req.user.username`, not the display name (`routes/crew-sos.ts:75, 252`).
- **Deleted by.** The `users` row delete. See section 3.

### 2.6 Avatar image

- **What.** One uploaded image per user. JPEG, PNG, GIF or WebP accepted
  (`lib/app-context/avatar.ts:72`), size-capped by `AVATAR_MAX_UPLOAD_BYTES`
  (`lib/app-context/avatar.ts:67`), re-encoded to WebP.
- **Stored.** As a file on the server's own disk, not in the database and not in
  object storage. Path: `<PUBLIC_DIR>/uploads/avatars/<avatarKey>.webp` —
  `lib/app-context/avatar.ts:28` and `:40`. The database keeps only the key and a
  cache-busting version: `users.avatar_key`, `avatar_version`, `avatar_updated_at`
  (`migrations/004_postgresql_baseline.sql:20-22`).
- **Served from.** A public, unauthenticated URL path built at
  `lib/helpers/export-utils.ts:180-182`:
  `/uploads/avatars/${user.avatarKey}.webp?v=${avatarVersion}`. The key is 12 random
  bytes in hex (`routes/account.ts:286`), so the URL is unguessable but not
  access-controlled.
- **Linked to identity.** Yes.
- **Third party.** No upload to any external service was found. Storage is local disk.
- **Deleted by.** Three paths:
  1. `DELETE /api/v1/account/avatar` removes the file immediately
     (`routes/account.ts:319-343`).
  2. The orphan sweep, every six hours, deletes any avatar file whose key does not
     belong to a live user (`lib/shutdown.ts:79-104`).
  3. The `users` row delete removes the key.

**Reportable behaviour, verify before writing a retention answer.** The orphan
sweep loads users with `getUsers()`, and the store's list query filters
`WHERE deleted_at IS NULL` (`lib/db/stores/users.ts:79`). A soft-deleted account is
therefore not in `validAvatarKeys` (`lib/shutdown.ts:87`), so its avatar file is
deleted at the next sweep — within about six hours of the deletion request, not at
the end of the 30-day grace period. `users.avatar_key` still holds the key, so an
account reactivated inside the grace window points at a file that no longer exists.
This is a safe direction to be wrong in for a privacy label (the image goes sooner,
not later), but it contradicts the in-app privacy text quoted in section 5.

### 2.7 Payment handles

- **What.** Optional Venmo handle, Cash App cashtag and PayPal handle, up to 64
  characters each, with a leading `@` or `$` stripped (`routes/account.ts:398-405`).
- **Stored.** `users.venmo_handle`, `users.cashapp_cashtag`, `users.paypal_handle` —
  `migrations/042_payment_handles.sql:8-10`.
- **Used for.** Building prefilled settle-up deep links.
- **Linked to identity.** Yes.
- **Exposure.** These are returned in the public user object
  (`lib/helpers.ts:65-67`), so crew members can see another member's handles.
- **Third party.** The server sends nothing to Venmo, Cash App or PayPal. The deep
  link is opened by the user's own device.
- **Deleted by.** The `users` row delete. See section 3.

These are payment identifiers, not payment instruments. On the App Store form the
closest category is "Financial Info"; on Play it is "Financial info — other
financial info". Declaring them is the safer reading, because the user typed them
and they are visible to other users.

**UNDETERMINED — the Play "shared with other users" question.** Play asks whether
data is shared. Crew visibility is in-app visibility to other users, not a transfer
to a third-party company. The owner must decide which reading the form intends for
crew-visible fields (payment handles, username, display name, avatar).

### 2.8 Free text the user writes

Every item below is "User Content" for Apple and "App activity" or "Personal info"
for Play, depending on the category the owner picks.

| Free text | Column | Limit | Delete path |
|---|---|---|---|
| Set notes | `festival_profiles.notes_json` (migration 004, line 113) and `festival_profile_notes.text` (migration 004, line 140) | 200 notes, 1000 characters each (`routes/profiles.ts:132-139`) | Soft-deleted with the profile at account deletion (`routes/account.ts:576`), hard-deleted at purge |
| Profile name | `festival_profiles.name` (migration 004, line 111) | Defaults to the username (`routes/profiles.ts:96`) | Same as above |
| Crew name | `crews.name` (migration 004, line 160) | 60 characters (`lib/schemas.ts:446`) | Survives the creator's deletion — see section 3.4 |
| Crew totem name | `crews.totem_name` (migration 056, line 16) | 40 characters (`lib/schemas.ts:448`) | Same as crew name |
| Crew photo album URL | `crews.photo_album_url` (migration 052, line 11) | A link only; Festie hosts no photos (migration 052, lines 4-6) | Same as crew name |
| Meeting-point label | `crew_meeting_points.label` (migration 017, line 8) | 100 characters (`lib/schemas.ts:505`) | Deleted at purge by `created_by` (`migrations/060...:147-149`) |
| Meeting-point location text | `crew_meeting_points.location` (migration 017, line 9) | 200 characters (`lib/schemas.ts:506`) | Same as label |
| Crew status note | `crew_member_status.note` (migration 051, line 22) | UNDETERMINED, see below | See the gap in section 3.3 |

**UNDETERMINED — crew status note length limit.** This review did not open the
crew-status route. The owner or the crew-data inventory must name the schema that
validates `note`.

---

## 3. Account deletion — the answer both forms ask for

### 3.1 The user-facing path

`DELETE /api/v1/account/` — `routes/account.ts:543`. It requires the account
password in the body (`lib/schemas.ts:226-228`) and is rate-limited to five
attempts (`routes/account.ts:546`).

In-app deletion exists in the mobile app: `packages/mobile/components/AccountDangerSection.tsx:30`
and `:75` call `authStore.deleteAccount(password)`, which calls this endpoint.

**UNDETERMINED — the Play deletion URL.** Play asks for a publicly reachable web
URL where a user can request account deletion without installing the app. No such
page was found in `public/` or `routes/pages.ts`. The owner must confirm whether one
exists on festie.us and, if not, must create one before answering that Play question.

### 3.2 What deletion does immediately

The whole immediate effect is these seven lines, `routes/account.ts:569-577`:

```ts
const performSoftDelete = async () => {
  await stores.users.update(req.user.userId, { deletedAt: new Date().toISOString() });
  invalidateUserCache();
  await invalidateUserSessions(req.user.userId);
  if (stores.refreshTokens) await stores.refreshTokens.revokeAll(req.user.userId);
  if (stores.deviceTokens) await stores.deviceTokens.deleteByUser(req.user.userId);
  if (stores.profiles) await stores.profiles.deleteByUserId(req.user.userId);
  disconnectUserSockets(req.user.userId, io);
};
```

Erased or revoked at once:

- All login sessions and refresh tokens.
- All push device tokens (a real delete).
- Live socket connections.
- The avatar file, at the next six-hourly sweep — see section 2.6.

Marked deleted but retained:

- The `users` row itself, including username, password hash, email, date of birth,
  display name, and payment handles. The row is only stamped with `deleted_at`.
- Festival profiles, which are also soft-deleted, not removed
  (`lib/db/stores/profiles.ts:350-352` sets `deleted_at`), so picks and notes remain.
- Crew memberships, crew content, meeting points, expenses, poll votes, notification
  history and audit rows.

The response tells the user the deletion date:
`deletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)` — `routes/account.ts:597`.

### 3.3 What happens after 30 days

The purge is a database function, `retention_cleanup()`, defined at
`migrations/060_retention_cleanup_owned_crews.sql:22`. Its user section begins at
line 111 and ends with `DELETE FROM users WHERE deleted_at < now() - interval '30 days'`
at line 206.

It deletes, for each purged user: `set_ratings`, `notification_topic_subs`,
`notification_preferences`, `notification_log`, `notification_counts`,
`device_tokens`, `calendar_tokens`, `festival_profiles`, `crew_poll_votes`,
`crew_polls`, `crew_meeting_points`, `crew_members`, `crew_expenses`,
`crew_activity`, `login_failures`, `email_verification_tokens`,
`password_reset_tokens`, `refresh_tokens`, `user_sessions`, `user_roles`, and
finally the `users` row (lines 113-206).

`spotify_accounts` needs no explicit delete: its foreign key is
`ON DELETE CASCADE` (`migrations/049_spotify_accounts.sql:16`), so the encrypted
Spotify refresh token goes with the user row.

**Gap 1 — `crew_member_status` is not purged.** The admin hard-delete path deletes
it explicitly and says why (`lib/db/stores/users.ts:242-245`: "has no FK to users …
the rows (incl. GPS/ETA breadcrumbs) would just orphan silently"). The scheduled
`retention_cleanup()` has no such statement. Rows there hold the user's status text,
free-text note, ETA and last-known coordinates (`migrations/051`, `migrations/055`).
Unless a crew is deleted, these rows appear to survive the account purge, keyed to a
user id that no longer exists.

**Gap 2 — `audit_log` retains the user id and IP for one year.** Deleted only by age,
never by user: `DELETE FROM audit_log WHERE created_at < now() - interval '1 year'`
(`migrations/060_retention_cleanup_owned_crews.sql:28-29`). The table holds
`actor_id`, `target_id`, `ip`, `user_agent` and a JSON details blob
(`migrations/004_postgresql_baseline.sql:286-296`, `migrations/008_audit_log_enhancements.sql:5-8`).

**Gap 3 — application logs retain the username and IP.** The deletion itself is
logged with both: `log.warn('account:soft-delete', { userId, username, ip: getRequestIp(req) })`
at `routes/account.ts:587-591`. Two rotation mechanisms cover the PM2 logs on the
server, both verified on 2026-09-09:

- The `pm2-logrotate` module rotates at `max_size 10M` or on the daily schedule
  `0 0 * * *`, and keeps `retain 7` generations, compressed. Read the live values
  with `pm2 conf pm2-logrotate`.
- A user-cron logrotate covers the same directory: `~/.config/logrotate-festie.conf`
  matches `<app dir>/logs/*.log` with `size 10M` and `rotate 4`, run weekly by the
  crontab entry `0 4 * * 0`.

Retention is therefore driven by log volume, not by a fixed number of days, so no
specific day count can be claimed. Under `retain 7` and a daily rotation, seven
generations is the floor; a busy period that hits the 10M size trigger repeatedly
shortens the window, and a quiet period lengthens it. An earlier version of this
document cited `logrotate.d/festie.conf`, a `/opt/festie/logs/pm2-*.log` block and
roughly 14 days of retention. Neither of those paths exists on the host, and the
14-day figure was not supported by either configuration.

### 3.4 What deliberately survives deletion

Crews created by a deleted user are **not** deleted if anyone else is still a member.
Ownership transfers to the longest-standing remaining member
(`migrations/060_retention_cleanup_owned_crews.sql:179-203`, mirrored in
`lib/db/stores/users.ts:255-278`). The crew name, totem, and any meeting points
created by other members remain. The crew is deleted only when the departing user
was its sole member.

This is defensible, and both forms allow it, but the owner should state it in the
privacy policy: content a user created inside a shared group can outlive their account.

### 3.5 The critical unknown

**UNDETERMINED — does the 30-day purge actually run in production?**

`retention_cleanup()` is a function. Nothing in the application calls it. A repo-wide
search for the name outside `migrations/` returns only a test
(`tests/crew-owner-hard-delete.test.ts:98`). The only scheduler is the conditional
block at `migrations/034_cleanup_and_retention.sql:108-127`, which registers a daily
03:00 UTC pg_cron job **only if the pg_cron extension is available**, and is
"silently skipped when pg_cron is not installed" (line 109).

The owner must verify, against the production database, that:

1. The pg_cron extension is installed.
2. A `cron.job` row named `retention_cleanup` exists and is enabled.
3. Its recent runs succeeded. Migrations 053 and 060 both exist because earlier
   versions of this function aborted at runtime and left the purge dead for a long
   period.

Until that is confirmed, the honest answer to "data is deleted after 30 days" is
unproven. Do not tick a deletion-retention claim on either form on the strength of
the SQL alone.

---

## 4. Data that is never collected

Stating an absence is also a declaration. These were checked and not found in the
account and identity paths:

- No phone number column exists on `users`.
- No real name field beyond the optional display name.
- No physical address.
- No password is stored or transmitted in plaintext.
- No account identifier is attached to crash reports. Sentry is initialised with a
  DSN and a trace sample rate only (`packages/mobile/app/_layout.tsx:64-68`), and no
  `Sentry.setUser` call exists anywhere in `packages/mobile`. Whether the Sentry SDK
  attaches an IP address or a device identifier by default belongs to the diagnostics
  inventory, not this one.

On the device, the session token is held in `expo-secure-store`, the OS keychain or
keystore (`packages/mobile/bootstrap.ts:18-22`), not in plain AsyncStorage.

---

## 5. Conflicts with the shipped privacy text

The in-app privacy screen at `packages/mobile/app/privacy.tsx:140` says:

> "After 30 days, all account data (username, password hash, avatar) is permanently
> deleted"

Three qualifications from the code:

1. The avatar file is deleted much earlier, within about six hours (section 2.6).
2. "All account data" is not exact. The audit log keeps the user id and IP for a year,
   and `crew_member_status` rows are not purged at all (section 3.3).
3. The 30-day purge depends on pg_cron being installed and healthy in production,
   which is unverified (section 3.5).

The privacy text and the store declarations must agree. Both stores compare the two.

---

## 6. Owner checklist before typing either form

1. Confirm pg_cron is installed and the `retention_cleanup` job is running and
   succeeding in the production database.
2. Read the Resend account's data-retention setting, and record how long Resend keeps
   recipient addresses and message bodies.
3. Decide whether a public web page for account-deletion requests exists on festie.us,
   and create one if it does not. Play asks for the URL.
4. Decide how to answer Play's sharing question for crew-visible fields: username,
   display name, avatar, payment handles.
5. Reconcile `packages/mobile/app/privacy.tsx` with sections 2.6 and 3.3 before
   submission, or fix the two code gaps instead.
6. Confirm the crew-status note length limit and the crew-status delete path with the
   crew-data inventory.

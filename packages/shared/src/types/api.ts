import type { User } from './domain';
import type { paths } from './api.gen';

export interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
}

export interface ApiError {
  status: number;
  code?: string;
  message: string;
  retryAfter?: number | string | null;
  isNetworkError?: boolean;
}

/**
 * Generated-type bridge (Phase B). `RequestBody<P, M>` extracts the
 * `application/json` request body of a path+method from the OpenAPI types in
 * `./api.gen.ts`, which are themselves generated from the spec whose request
 * contracts are derived from the authoritative Zod schemas in `lib/schemas.ts`.
 * Aliasing a hand-written request interface to one of these makes the Zod schema
 * the SINGLE SOURCE for that request shape — the interface can no longer drift.
 *
 * Only used where the generated shape is mutually assignable with the existing
 * hand-written interface (so no consumer churns); see the per-alias notes below.
 */
type RequestBody<P extends keyof paths, M extends keyof paths[P]> = NonNullable<
  paths[P][M] extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never
>;

/**
 * SINGLE-SOURCED from the Zod `loginSchema` (via the OpenAPI spec → api.gen.ts).
 * The generated body is `{ username: string; password: string }`, mutually
 * assignable with the prior hand-written interface and with every call site
 * (`api.post('/auth/login', { username, password })`), so the alias closes the
 * duplication with zero consumer churn. Edit the bounds in `lib/schemas.ts` and
 * they flow here on regenerate.
 */
export type LoginRequest = RequestBody<'/api/v1/auth/login', 'post'>;

/**
 * STILL HAND-WRITTEN (intentionally not aliased to the generated register body).
 * The Zod `registerSchema` makes `dateOfBirth` and `tosAccepted` REQUIRED and
 * pins `tosAccepted` to the literal `true`. Several shared store tests call
 * `register({ username, password, confirmPassword, tosAccepted })` WITHOUT
 * `dateOfBirth`, and UI call sites pass `tosAccepted` as a plain boolean state
 * value. Aliasing to the generated shape would turn those into TS errors and
 * cascade a red shared/web typecheck — exactly the breakage the prime directive
 * forbids. Kept as the looser hand-written contract until those consumers are
 * migrated; the validator remains the runtime source of truth regardless.
 */
export interface RegisterRequest {
  username: string;
  password: string;
  confirmPassword: string;
  /** YYYY-MM-DD. Required by the backend 18+ age gate at registration. */
  dateOfBirth?: string;
  tosAccepted: boolean;
  email?: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface SavePickRequest {
  festivalId: string;
  setId: string;
  priority: 'must' | 'want-to-see' | 'maybe' | null;
  updatedAt?: string;
  etag?: string;
}

export interface SaveNoteRequest {
  festivalId: string;
  setId: string;
  note: string;
}

export interface SaveReminderRequest {
  festivalId: string;
  setId: string;
  /** Lead time in minutes (5|10|15|30|60), or null to clear the reminder. */
  minutes: number | null;
}

export interface UpdateProfileRequest {
  picks?: Record<string, string>;
  notes?: Record<string, string>;
  etag?: string;
}

export interface UploadAvatarRequest {
  file: File | Blob;
}

/**
 * Shape of the avatar upload/remove response after the api-client envelope is
 * unwrapped. The server (routes/account.ts) returns the full re-serialized user
 * via serializePublicUser, whose avatar field is `avatarUrl` (null when cleared).
 */
export interface AvatarResponse {
  user: User;
}

export interface UserSettingsRequest {
  name?: string;
  email?: string;
  notificationPrefs?: {
    emailNotifications?: boolean;
    pushNotifications?: boolean;
    scheduleAlerts?: boolean;
  };
}

export interface JoinCrewRequest {
  inviteCode: string;
}

export interface CreateCrewRequest {
  name: string;
  festivalId?: string;
  // Crew totem (rally marker). Both optional on create. `totemName` is trimmed +
  // capped at 40 chars server-side; `totemEmoji` is capped at 16 chars. Sent as
  // camelCase in the request body; the row comes back with snake_case
  // totem_name / totem_emoji (defaulting to null when unset).
  totemName?: string;
  totemEmoji?: string;
}

/**
 * Body for PUT /crews/:crewId — a general crew update. All fields optional; only
 * the keys present are applied. Currently carries the crew totem (rally marker);
 * sent camelCase, serialized back as snake_case totem_name / totem_emoji.
 */
export interface UpdateCrewRequest {
  name?: string;
  totemName?: string;
  totemEmoji?: string;
}

export interface TransferCrewRequest {
  newOwnerId: string;
}

export interface PollVoteRequest {
  pollId: string;
  optionId: string;
}

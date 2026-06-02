import type { User } from './domain';

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

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  confirmPassword: string;
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
}

export interface TransferCrewRequest {
  newOwnerId: string;
}

export interface PollVoteRequest {
  pollId: string;
  optionId: string;
}

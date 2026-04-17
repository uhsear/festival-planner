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

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UpdateProfileRequest {
  picks?: Record<string, string>;
  notes?: Record<string, string>;
  etag?: string;
}

export interface UploadAvatarRequest {
  file: File | Blob;
}

export interface AvatarResponse {
  url: string;
  updatedAt: string;
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

export interface MeetingPointRequest {
  festivalId: string;
  name: string;
  location: string;
  time?: string;
}

export interface ActivityRequest {
  festivalId: string;
  type: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
}

export interface RatingRequest {
  setId: string;
  score: number;
  comment?: string;
}

export interface ConflictDetectionRequest {
  festivalId: string;
  profileId: string;
}

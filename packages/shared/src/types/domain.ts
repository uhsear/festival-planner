export type Priority = 'must' | 'want-to-see' | 'maybe';

export interface Festival {
  id: string;
  name: string;
  description?: string;
  image?: string;
  startDate: string;
  endDate: string;
  location?: string;
  b2bSeparator?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FestivalListItem {
  id: string;
  name: string;
  image?: string;
  startDate: string;
}

export interface Stage {
  id: string;
  name: string;
  color?: string;
  festivalId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FestivalDay {
  id: string;
  festivalId: string;
  date: string;
  label?: string;
  dayIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Artist {
  id?: string;
  name: string;
  photo?: string;
  genres?: string[];
  links?: Record<string, string>;
}

export interface FestivalSet {
  id: string;
  festivalId: string;
  stageId: string;
  stageName?: string;
  date?: string;
  dayIndex?: number;
  startTime: string;
  endTime: string;
  artist?: string;
  artists?: Artist[];
  linkUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  avatar?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  data: {
    user: User;
    token?: string;
  };
  error?: null;
}

export interface Profile {
  id: string;
  userId: string;
  festivalId: string;
  name?: string;
  picks: Record<string, Priority>;
  notes: Record<string, string>;
  updatedAt: string;
  etag?: string;
}

export interface CrewMember {
  id: string;
  userId: string;
  name?: string;
  avatar?: string;
  role?: 'owner' | 'member';
}

export interface Crew {
  id: string;
  name: string;
  inviteCode?: string;
  owner: string;
  festivalId?: string;
  members: CrewMember[];
  // Home base is surfaced on the serialized crew (routes/crews.ts:48-50);
  // owner-only PUT /crews/:id/home-base updates it. Optional/nullable so the
  // additions don't break existing crew consumers.
  homeBaseLocation?: string | null;
  homeBaseTime?: string | null;
  homeBaseUpdatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrewOverlap {
  setId: string;
  memberCount: number;
  members: CrewMember[];
}

/**
 * Crew poll as serialized by the backend (routes/crew-polls.ts). Fields are
 * snake_case because they come straight from Postgres. `votes` is the raw vote
 * list — count per option is derived client-side. Distinct from the legacy
 * festival-scoped `Poll` type below, which is unrelated to crew polls.
 */
export interface CrewPollVote {
  option: number;
  user_id: string | null;
}

export interface CrewPoll {
  id: string;
  crew_id: string;
  created_by: string;
  question: string;
  options: string[];
  votes: CrewPollVote[];
  closes_at: string | null;
  closed: boolean;
  created_at: string;
}

export interface CreateCrewPollRequest {
  question: string;
  options: string[];
  closesAt?: string;
}

/**
 * Crew meeting point as serialized by the backend
 * (routes/crew-meeting-points.ts). snake_case from Postgres. Distinct from the
 * legacy festival-scoped `MeetingPoint` type below.
 */
export interface CrewMeetingPoint {
  id: string;
  crew_id: string;
  created_by: string;
  label: string;
  location: string;
  type: string;
  meet_at: string | null;
  stage_reference: string | null;
  active: boolean;
  created_at: string;
}

export interface CreateCrewMeetingPointRequest {
  label: string;
  location: string;
  type?: string;
  meetAt?: string | null;
  stageReference?: string | null;
}

export interface UpdateCrewMeetingPointRequest {
  label?: string;
  location?: string;
  type?: string;
  meetAt?: string | null;
  stageReference?: string | null;
}

/**
 * Crew expense as serialized by the backend (routes/crew-expenses.ts).
 * snake_case from Postgres. `amount` arrives as a numeric string from pg, so
 * consumers must Number() it. Distinct from the legacy `Expense` type below.
 */
export interface CrewExpense {
  id: string;
  crew_id: string;
  paid_by: string;
  paid_by_name: string;
  description: string;
  amount: string | number;
  split_with: string[];
  category: string;
  created_at: string;
}

export interface CrewExpenseBalance {
  userId: string;
  username: string;
  balance: number;
}

export interface CreateCrewExpenseRequest {
  description: string;
  amount: number;
  splitWith: string[];
  category: string;
}

export interface SettleCrewExpenseRequest {
  toUserId: string;
  amount: number;
}

/**
 * Crew activity-log entry (routes/crew-activity.ts). snake_case from Postgres.
 * `type` is a free-form event string ('member-joined', 'expense-added', …).
 * Distinct from the legacy festival-scoped `ActivityItem` type below.
 */
export interface CrewActivityEntry {
  id: string;
  crew_id: string;
  user_id: string;
  username: string;
  type: string;
  detail: string | null;
  created_at: string;
}

export interface Poll {
  id: string;
  festivalId: string;
  question: string;
  options: PollOption[];
  createdAt: string;
  updatedAt: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
}

export interface Expense {
  id: string;
  crewId: string;
  description: string;
  amount: number;
  paidBy: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingPoint {
  id: string;
  festivalId: string;
  name: string;
  location: string;
  time?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityItem {
  id: string;
  festivalId: string;
  type: string;
  title: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationPrefs {
  userId: string;
  emailNotifications: boolean;
  pushNotifications: boolean;
  scheduleAlerts: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WeatherPoint {
  date: string;
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
}

export interface WeatherData {
  festivalId: string;
  forecast: WeatherPoint[];
  updatedAt: string;
}

export interface Rating {
  id: string;
  userId: string;
  setId: string;
  score: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineUser {
  id: string;
  name?: string;
  avatar?: string;
  status: 'online' | 'away' | 'offline';
  lastSeen?: string;
}

export enum SocketEvents {
  PICKS_UPDATED = 'picks:updated',
  PROFILE_JOINED = 'profile:joined',
  PROFILE_LEFT = 'profile:left',
  CREW_UPDATED = 'crew:updated',
  CREW_MEMBER_JOINED = 'crew:member:joined',
  CREW_MEMBER_LEFT = 'crew:member:left',
  PRESENCE_UPDATE = 'presence:update',
  FESTIVAL_UPDATED = 'festival:updated',
  SET_UPDATED = 'set:updated',
  MESSAGE_CREATED = 'message:created',
  NOTIFICATION = 'notification',
  ERROR = 'error',
}

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
  inviteCode: string;
  owner: string;
  festivalId?: string;
  members: CrewMember[];
  createdAt: string;
  updatedAt: string;
}

export interface CrewOverlap {
  setId: string;
  memberCount: number;
  members: CrewMember[];
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

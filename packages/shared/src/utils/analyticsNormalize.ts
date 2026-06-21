/**
 * Shared normalizer for GET /admin/analytics.
 *
 * The server returns numeric aggregates as strings (raw SQL coercion), so every
 * numeric field goes through toNum(). Platform-agnostic: no DOM/window, no
 * Node-only APIs — safe for both web and React Native consumers.
 *
 * Extracted from packages/web/src/components/admin/analyticsTypes.ts so mobile
 * can reuse the same types and normalization without a web dependency.
 */

export interface TopSetData {
  artist: string;
  stageId: string | null;
  dayIndex: number | null;
  festivalId: string;
  startTime: string | null;
  endTime: string | null;
  pickCount: number;
  mustCount: number;
  wantCount: number;
  maybeCount: number;
}

export interface ActiveUser {
  id: string;
  username: string;
  profileCount: number;
  totalPicks: number;
  lastActive: string;
}

export interface CrewSummary {
  id: string;
  name: string;
  festivalId: string;
  memberCount: number;
  createdAt: string;
}

export interface FestivalStatData {
  id: string;
  name: string;
  profileCount: number;
  uniqueSetsPicked: number;
  totalPicks: number;
}

export interface AnalyticsData {
  topSets: TopSetData[];
  activeUsers: ActiveUser[];
  crews: CrewSummary[];
  festivalStats: FestivalStatData[];
  generatedAt: string | null;
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function normalizeAnalytics(raw: unknown): AnalyticsData {
  const r = (raw ?? {}) as Record<string, unknown>;
  const topSets = Array.isArray(r.topSets) ? r.topSets : [];
  const activeUsers = Array.isArray(r.activeUsers) ? r.activeUsers : [];
  const crews = Array.isArray(r.crews) ? r.crews : [];
  const festivalStats = Array.isArray(r.festivalStats) ? r.festivalStats : [];
  return {
    topSets: topSets.map((s: Record<string, unknown>) => ({
      artist: toStr(s?.artist),
      stageId: typeof s?.stageId === 'string' ? s.stageId : null,
      dayIndex: typeof s?.dayIndex === 'number' ? s.dayIndex : null,
      festivalId: toStr(s?.festivalId),
      startTime: typeof s?.startTime === 'string' ? s.startTime : null,
      endTime: typeof s?.endTime === 'string' ? s.endTime : null,
      pickCount: toNum(s?.pickCount),
      mustCount: toNum(s?.mustCount),
      wantCount: toNum(s?.wantCount),
      maybeCount: toNum(s?.maybeCount),
    })),
    activeUsers: activeUsers.map((u: Record<string, unknown>) => ({
      id: toStr(u?.id),
      username: toStr(u?.username),
      profileCount: toNum(u?.profileCount),
      totalPicks: toNum(u?.totalPicks),
      lastActive: toStr(u?.lastActive),
    })),
    crews: crews.map((c: Record<string, unknown>) => ({
      id: toStr(c?.id),
      name: toStr(c?.name),
      festivalId: toStr(c?.festivalId),
      memberCount: toNum(c?.memberCount),
      createdAt: toStr(c?.createdAt),
    })),
    festivalStats: festivalStats.map((f: Record<string, unknown>) => ({
      id: toStr(f?.id),
      name: toStr(f?.name),
      profileCount: toNum(f?.profileCount),
      uniqueSetsPicked: toNum(f?.uniqueSetsPicked),
      totalPicks: toNum(f?.totalPicks),
    })),
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
  };
}

export const ANALYTICS_DEFAULTS: AnalyticsData = {
  topSets: [],
  activeUsers: [],
  crews: [],
  festivalStats: [],
  generatedAt: null,
};

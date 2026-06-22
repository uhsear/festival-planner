import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ── Store state the mocks read from (mutated per test) ─────────────────────
const authState: Record<string, unknown> = { user: { id: 'u-me' } };
const crewState: Record<string, unknown> = {};
const festivalState: Record<string, unknown> = {};
const uiState: Record<string, unknown> = { offlineMode: false, pendingSync: 0 };

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(authState)),
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));

// FreshnessChip reaches into these split-store entry points directly.
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(uiState)),
}));
vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));
vi.mock('@festie/shared/stores/festivalDataStore', () => ({
  useFestivalDataStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));

// Real router would need a RouterProvider context; stub the two primitives.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock('../components/ui/EmptyState', () => ({
  default: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  ),
}));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import CrewPlanView from './crew-plan';

/** A future timestamp (ms) `mins` from now, as an ISO string. */
function isoInMinutes(mins: number): string {
  return new Date(Date.now() + mins * 60_000).toISOString();
}

/** A HH:MM wall-clock string `mins` from now (local), for set start times. */
function timeInMinutes(mins: number): string {
  const d = new Date(Date.now() + mins * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Pin the clock to a fixed mid-afternoon LOCAL instant so the relative set
// times below (start = now+45m, end = now+105m) can never straddle a midnight
// rollover at run time. Without this the "next picks" section flakes empty when
// the suite runs near local midnight — a UTC-only CI machine hides it. Mid-day
// keeps start/end on the same calendar day in every timezone.
const FIXED_NOW = new Date('2026-06-15T14:00:00');
const TODAY = FIXED_NOW.toLocaleDateString('en-CA');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  authState.user = { id: 'u-me' };
  uiState.offlineMode = false;
  uiState.pendingSync = 0;

  // Two crew members; the digest is crew-scoped to these.
  crewState.activeCrew = {
    id: 'c1',
    name: 'Sunset Squad',
    owner: 'u-me',
    members: [
      { id: 'm1', userId: 'u-me', name: 'Me', role: 'owner' },
      { id: 'm2', userId: 'u-friend', name: 'Ari', role: 'member' },
    ],
    homeBaseLocation: 'Lot C, blue flag',
    homeBaseTime: 'Back by 2am',
  };
  crewState.crewMembers = crewState.activeCrew.members;
  crewState.meetingPoints = [
    {
      id: 'mp1',
      crew_id: 'c1',
      created_by: 'u-me',
      label: 'The big tree',
      location: 'Near main gate',
      type: 'custom',
      meet_at: isoInMinutes(90),
      stage_reference: null,
      active: true,
      created_at: new Date().toISOString(),
    },
  ];
  // FreshnessChip surface="crew" reads _cachedAt from the crew store mock.
  crewState._cachedAt = Date.now() - 5 * 60_000;
  crewState._festivalCachedAt = Date.now() - 5 * 60_000;

  // One upcoming set; both members pick it (different priorities).
  const startTime = timeInMinutes(45);
  festivalState.sets = [
    {
      id: 's1',
      festivalId: 'f1',
      stageId: 'st1',
      date: TODAY,
      dayIndex: 0,
      startTime,
      endTime: timeInMinutes(105),
      artist: 'Disclosure',
      createdAt: '',
      updatedAt: '',
    },
  ];
  festivalState.days = [{ id: 'd0', festivalId: 'f1', date: TODAY, dayIndex: 0, createdAt: '', updatedAt: '' }];
  festivalState.allProfiles = [
    {
      id: 'p-me',
      userId: 'u-me',
      festivalId: 'f1',
      name: 'Me',
      picks: { s1: 'must' },
      notes: {},
      updatedAt: '',
    },
    {
      id: 'p-ari',
      userId: 'u-friend',
      festivalId: 'f1',
      name: 'Ari',
      picks: { s1: 'maybe' },
      notes: {},
      updatedAt: '',
    },
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CrewPlanView', () => {
  it('renders the crew plan digest from cache (meeting point, home base, next picks)', () => {
    render(<CrewPlanView />);

    // Active meeting point
    expect(screen.getByText('The big tree')).toBeInTheDocument();
    expect(screen.getByText('Near main gate')).toBeInTheDocument();

    // Home base
    expect(screen.getByText('Lot C, blue flag')).toBeInTheDocument();
    expect(screen.getByText('Back by 2am')).toBeInTheDocument();

    // Who-picked-what's-next: both members, with the highest-priority label
    expect(screen.getByText('Me')).toBeInTheDocument();
    expect(screen.getByText('Ari')).toBeInTheDocument();
    expect(screen.getAllByText('Disclosure').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Must')).toBeInTheDocument();
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('issues zero network requests (no fetch / XHR)', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    render(<CrewPlanView />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows an empty state when no crew is selected', () => {
    crewState.activeCrew = null;
    crewState.crewMembers = [];
    render(<CrewPlanView />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText('No crew selected')).toBeInTheDocument();
  });
});

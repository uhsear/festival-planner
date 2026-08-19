import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyCrewAccessRevoked, applyCrewMemberKicked, applySessionRevoked } from '../revocationHandlers';
import { useCrewStore } from '../../stores/crewStore';
import { useAuthStore } from '../../stores/authStore';
import { useLiveLocationStore } from '../../stores/liveLocationStore';
import type { Crew, CrewMember, User } from '../../types/domain';

vi.mock('../../services/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const me: User = {
  id: 'user-1',
  username: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const members: CrewMember[] = [
  { userId: 'user-1', name: 'Alice', role: 'owner' },
  { userId: 'user-2', name: 'Bob', role: 'member' },
];

function crew(id: string): Crew {
  return {
    id,
    name: `Crew ${id}`,
    owner: 'user-1',
    members,
    inviteCode: 'ABC123',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

/** Signed in as user-1, crew-1 open with two members, crew-2 in the list. */
function seed() {
  useAuthStore.setState({ user: me, userToken: 'tok' });
  useCrewStore.setState({
    crews: [crew('crew-1'), crew('crew-2')],
    activeCrew: crew('crew-1'),
    crewMembers: [...members],
    polls: [{ id: 'poll-1' } as never],
    meetingPoints: [{ id: 'mp-1' } as never],
    expenses: [{ id: 'exp-1' } as never],
    _cachedAt: 123,
    _cachedCrewId: 'crew-1',
  });
  useLiveLocationStore.getState().setActiveCrew('crew-1');
}

beforeEach(() => {
  vi.restoreAllMocks();
  seed();
});

describe('applyCrewAccessRevoked', () => {
  it('drops the crew and every crew-scoped slice when it is the open crew', () => {
    applyCrewAccessRevoked('crew-1');

    const s = useCrewStore.getState();
    expect(s.crews.map((c) => c.id)).toEqual(['crew-2']);
    expect(s.activeCrew).toBeNull();
    expect(s.crewMembers).toEqual([]);
    expect(s.polls).toEqual([]);
    expect(s.meetingPoints).toEqual([]);
    expect(s.expenses).toEqual([]);
    // Persisted cache keys must clear or a cold start rehydrates the revoked crew.
    expect(s._cachedAt).toBeNull();
    expect(s._cachedCrewId).toBeNull();
    expect(useLiveLocationStore.getState().crewId).toBeNull();
  });

  it('drops a background crew without disturbing the open one', () => {
    applyCrewAccessRevoked('crew-2');

    const s = useCrewStore.getState();
    expect(s.crews.map((c) => c.id)).toEqual(['crew-1']);
    expect(s.activeCrew?.id).toBe('crew-1');
    expect(s.crewMembers).toHaveLength(2);
    expect(s.polls).toHaveLength(1);
    expect(useLiveLocationStore.getState().crewId).toBe('crew-1');
  });
});

describe('applyCrewMemberKicked', () => {
  it('SELF kick tears down access to that crew', () => {
    applyCrewMemberKicked('crew-1', 'user-1');

    const s = useCrewStore.getState();
    expect(s.crews.map((c) => c.id)).toEqual(['crew-2']);
    expect(s.activeCrew).toBeNull();
    expect(s.crewMembers).toEqual([]);
  });

  it('OTHER member kick only removes that roster row — crew stays', () => {
    applyCrewMemberKicked('crew-1', 'user-2');

    const s = useCrewStore.getState();
    expect(s.crews.map((c) => c.id)).toEqual(['crew-1', 'crew-2']);
    expect(s.activeCrew?.id).toBe('crew-1');
    expect(s.crewMembers.map((m) => m.userId)).toEqual(['user-1']);
    expect(s.activeCrew?.members.map((m) => m.userId)).toEqual(['user-1']);
  });

  it('ignores a kick aimed at a crew that is not open', () => {
    applyCrewMemberKicked('crew-2', 'user-2');

    const s = useCrewStore.getState();
    expect(s.crewMembers.map((m) => m.userId)).toEqual(['user-1', 'user-2']);
    expect(s.crews).toHaveLength(2);
  });

  it('treats an unknown current user as "another member" (never self-evicts)', () => {
    useAuthStore.setState({ user: null });

    applyCrewMemberKicked('crew-1', 'user-1');

    const s = useCrewStore.getState();
    expect(s.activeCrew?.id).toBe('crew-1');
    expect(s.crews).toHaveLength(2);
    expect(s.crewMembers.map((m) => m.userId)).toEqual(['user-2']);
  });

  it('ignores a malformed payload', () => {
    applyCrewMemberKicked('', '');
    applyCrewMemberKicked('crew-1', undefined as unknown as string);

    expect(useCrewStore.getState().crewMembers).toHaveLength(2);
  });
});

describe('applySessionRevoked', () => {
  it('logs out and then runs the platform navigation', async () => {
    const order: string[] = [];
    const logout = vi.fn(async () => {
      order.push('logout');
      useAuthStore.setState({ user: null, userToken: null });
    });
    useAuthStore.setState({ logout });

    await applySessionRevoked(() => order.push('navigate'));

    expect(order).toEqual(['logout', 'navigate']);
    expect(useAuthStore.getState().userToken).toBeNull();
  });

  it('still navigates when the logout call throws', async () => {
    useAuthStore.setState({
      logout: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    const onRevoked = vi.fn();

    await expect(applySessionRevoked(onRevoked)).rejects.toThrow('offline');
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });
});

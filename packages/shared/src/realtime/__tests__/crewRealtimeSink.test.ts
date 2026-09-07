import { describe, it, expect, beforeEach } from 'vitest';
import { createStoreSink } from '../crewRealtimeSink';
import { useCrewStore } from '../../stores/crewStore';
import { useLiveLocationStore } from '../../stores/liveLocationStore';
import type { SosEntry } from '../../types/domain';

const CREW = 'crew-1';

function makeSos(userId: string, username: string): SosEntry {
  return {
    crewId: CREW,
    userId,
    username,
    message: 'Need help at main stage',
    position: { lat: 40.1, lng: -74.1, accuracy: 8, capturedAt: '2026-06-06T12:00:00.000Z' },
    activityId: `act-${userId}`,
    raisedAt: '2026-06-06T12:00:00.000Z',
  };
}

describe('crewRealtimeSink: sos:cleared clears only the raiser it names', () => {
  beforeEach(() => {
    useLiveLocationStore.getState().reset();
    useLiveLocationStore.setState({ crewId: CREW });
  });

  // Regression: both sinks called clearSos() with no argument, which the store
  // documents as the drop-every-SOS path. Resolving one member's SOS therefore
  // wiped every other member's still-active SOS from the map.
  it('leaves another member SOS active when one is cleared', () => {
    const sink = createStoreSink(useCrewStore, useLiveLocationStore);

    sink.onSosRaised(CREW, makeSos('user-a', 'Alice'));
    sink.onSosRaised(CREW, makeSos('user-b', 'Bob'));
    expect(useLiveLocationStore.getState().activeSosList).toHaveLength(2);

    sink.onSosCleared(CREW, 'user-a', 'Alice');

    const remaining = useLiveLocationStore.getState().activeSosList;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe('user-b');
  });

  it('is a no-op for a raiser with no active SOS', () => {
    const sink = createStoreSink(useCrewStore, useLiveLocationStore);

    sink.onSosRaised(CREW, makeSos('user-b', 'Bob'));
    sink.onSosCleared(CREW, 'user-a', 'Alice');

    expect(useLiveLocationStore.getState().activeSosList).toHaveLength(1);
  });
});

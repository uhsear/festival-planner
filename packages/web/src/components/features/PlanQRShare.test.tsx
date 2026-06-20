// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { decodePlanSnapshot } from '@festie/shared/utils';

// Store mocks: PlanQRShare reads currentFestival/currentProfile from
// festivalStore and meetingPoints from crewStore, both via selector. Back them
// with mutable state objects, mirroring the picks.test.tsx pattern.
const festivalState: Record<string, unknown> = {};
const crewState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
  useCrewStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(crewState)),
}));

// Stub lucide so we don't depend on its real icon exports here.
vi.mock('lucide-react', () => ({
  QrCode: () => <span data-testid="qr-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

// We assert on the value passed to the QR renderer rather than its SVG output:
// that is the load-bearing contract (it must be the encoded snapshot).
let lastQRValue: string | null = null;
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => {
    lastQRValue = value;
    return <svg data-testid="qr-svg" data-value={value} />;
  },
}));

import PlanQRShare from './PlanQRShare';

function setState({
  festival = { id: 'f1', name: 'Bonnaroo' } as unknown,
  profile = { picks: {} as Record<string, string> } as unknown,
  meetingPoints = [] as unknown[],
}: {
  festival?: unknown;
  profile?: unknown;
  meetingPoints?: unknown[];
} = {}) {
  Object.keys(festivalState).forEach((k) => delete festivalState[k]);
  Object.keys(crewState).forEach((k) => delete crewState[k]);
  Object.assign(festivalState, { currentFestival: festival, currentProfile: profile });
  Object.assign(crewState, { meetingPoints });
}

/** Open the modal so the body (QR / messaging) renders into the portal. */
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Share plan as QR code' }));
}

describe('PlanQRShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastQRValue = null;
    setState();
  });

  it('renders the trigger button', () => {
    render(<PlanQRShare />);
    expect(screen.getByRole('button', { name: 'Share plan as QR code' })).toBeInTheDocument();
  });

  it('encodes a scannable snapshot and renders it as a QR given picks', () => {
    setState({ profile: { picks: { s1: 'must', s2: 'want-to-see', s3: 'maybe' } } });
    render(<PlanQRShare />);
    open();

    expect(screen.getByTestId('plan-qr-code')).toBeInTheDocument();
    expect(lastQRValue).toBeTruthy();

    // The QR value must be exactly what the shared codec produces: round-trip it.
    const decoded = decodePlanSnapshot(lastQRValue);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.festivalId).toBe('f1');
      expect(decoded.data.festivalName).toBe('Bonnaroo');
      expect(decoded.data.picks).toHaveLength(3);
      // Picks ranked must > want > maybe; the wire codec shortens want-to-see to want.
      expect(decoded.data.picks[0]).toEqual({ setId: 's1', priority: 'must' });
      expect(decoded.data.picks.map((p) => p.priority)).toEqual(['must', 'want', 'maybe']);
    }
    // Honest, snapshot-not-live-link copy from mobile (substring matchers avoid
    // depending on exact text-node boundaries within the paragraph).
    expect(screen.getByText(/nothing is sent over the internet/)).toBeInTheDocument();
    expect(screen.getByText(/snapshot copy, not a live link/)).toBeInTheDocument();
  });

  it('includes an active meeting point with coords in the snapshot', () => {
    setState({
      profile: { picks: { s1: 'must' } },
      meetingPoints: [{ id: 'm1', label: 'Main Gate', active: true, latitude: 36.1, longitude: -86.7, meet_at: null }],
    });
    render(<PlanQRShare />);
    open();

    const decoded = decodePlanSnapshot(lastQRValue);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.data.meetingPoint).toEqual({ label: 'Main Gate', lat: 36.1, lng: -86.7 });
    }
    expect(screen.getByText(/meet at Main Gate/)).toBeInTheDocument();
  });

  it('renders a QR even with zero picks (empty plan is still shareable)', () => {
    setState({ profile: { picks: {} } });
    render(<PlanQRShare />);
    open();

    expect(screen.getByTestId('plan-qr-code')).toBeInTheDocument();
    const decoded = decodePlanSnapshot(lastQRValue);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.data.picks).toHaveLength(0);
    expect(screen.getByText(/^0 picks/)).toBeInTheDocument();
  });

  it('prompts to open a festival + add picks when there is no festival/profile', () => {
    setState({ festival: null, profile: null });
    render(<PlanQRShare />);
    open();

    expect(screen.queryByTestId('plan-qr-code')).toBeNull();
    expect(screen.getByText(/Open a festival and add a few picks/)).toBeInTheDocument();
  });

  it('shows a friendly too-large note when the encoded snapshot exceeds the bound', () => {
    // A pick id far longer than MAX_ENCODED_LENGTH (4096) forces tooLong=true
    // even after the codec's MAX_PICKS cap, since each id passes through intact.
    const huge = 'x'.repeat(5000);
    setState({ profile: { picks: { [huge]: 'must' } } });
    render(<PlanQRShare />);
    open();

    expect(screen.queryByTestId('plan-qr-code')).toBeNull();
    expect(screen.getByTestId('plan-qr-too-large')).toBeInTheDocument();
    expect(screen.getByText(/too big to fit in one QR code/)).toBeInTheDocument();
  });
});

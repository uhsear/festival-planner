import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ------------------------------------------------------------------

// Icons → inert spans so we assert on text/roles, not SVG internals.
vi.mock('lucide-react', () => {
  const Icon = () => <span data-testid="icon" />;
  return { Square: Icon, Siren: Icon, Navigation: Icon, ShieldCheck: Icon, X: Icon, MapPin: Icon, Loader: Icon };
});

// api.post — the SOS raise/clear path. Captured so we can assert payloads and
// flip success/failure per-test.
const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock('@festie/shared', () => ({ api: { post: apiPost } }));

// constants (SESSION_MINUTES is derived from MAX_SESSION_MS).
vi.mock('@festie/shared/constants', () => ({ LIVE_LOCATION: { MAX_SESSION_MS: 3_600_000 } }));

// utils — formatStaleness is the only one used by this component.
vi.mock('@festie/shared/utils', () => ({ formatStaleness: () => 'as of just now' }));

// The publisher hook is a side-effect engine (geolocation + socket). We don't
// exercise it here; capture its options so we can assert the component wires
// `enabled` to the share toggle, then no-op.
const { publisherSpy } = vi.hoisted(() => ({ publisherSpy: vi.fn() }));
vi.mock('@festie/shared/hooks', () => ({ useLiveLocationPublisher: (opts: unknown) => publisherSpy(opts) }));

// liveLocationStore — a controllable in-memory state. Selector-based hook +
// getState().clearSos() (used by the optimistic clear path).
const { storeState, clearSosSpy } = vi.hoisted(() => ({
  storeState: { sharingCrewId: null as string | null, sos: null as unknown },
  clearSosSpy: vi.fn(),
}));
function useLiveLocationStore(selector: (s: typeof storeState) => unknown) {
  return selector(storeState);
}
useLiveLocationStore.getState = () => ({ ...storeState, clearSos: clearSosSpy });
vi.mock('@festie/shared/stores/liveLocationStore', () => ({ useLiveLocationStore }));

// Shared socket — connected by default so the share toggle is allowed.
const { socketState } = vi.hoisted(() => ({ socketState: { connected: true } }));
vi.mock('../../lib/socketContext', () => ({ useSharedSocket: () => socketState }));

// Toast — capture calls so we can assert user-facing feedback.
const { toastSpy } = vi.hoisted(() => ({ toastSpy: vi.fn() }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: toastSpy }) }));

import LiveLocationControls from './LiveLocationControls';

const CREW_ID = 'crew-1';
const ME = 'user-me';

function resetStore() {
  storeState.sharingCrewId = null;
  storeState.sos = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  // jsdom has no geolocation by default; provide a stub so toggleSharing's
  // capability check passes. watchPosition/getCurrentPosition are never invoked
  // here because the publisher hook is mocked.
  // getCurrentPosition must INVOKE a callback or the SOS one-shot Promise never
  // settles. Default: fire the error cb → oneShotPosition resolves undefined
  // (the "couldn't get a fix, raise anyway" path), so the POST still goes out.
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 1 } as GeolocationPositionError),
      ),
    },
  });
});

describe('LiveLocationControls — share toggle', () => {
  it('renders an accessible, labelled, OFF-by-default switch', () => {
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAccessibleName('Share my live location with this crew');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    // No sharing indicator until opted in.
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
  });

  it('shows the "you are sharing" indicator and flips aria-checked after opt-in', async () => {
    const user = userEvent.setup();
    // The store mirrors the active sharing crew once the toggle turns on.
    storeState.sharingCrewId = CREW_ID;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('switch'));

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    const indicator = screen.getByTestId('sharing-indicator');
    expect(indicator).toHaveAttribute('role', 'status');
    expect(within(indicator).getByText(/you'?re sharing your live location/i)).toBeInTheDocument();
    // Anti-slop: the indicator states scope + auto-stop, not just "sharing".
    expect(within(indicator).getByText(/only this crew can see it/i)).toBeInTheDocument();
    // A one-tap, labelled Stop is present.
    expect(within(indicator).getByRole('button', { name: /stop sharing/i })).toBeInTheDocument();
  });

  it('refuses to start sharing (and warns) when the socket is disconnected', async () => {
    const user = userEvent.setup();
    socketState.connected = false;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('switch'));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/not connected/i), 'error');
    expect(screen.queryByTestId('sharing-indicator')).not.toBeInTheDocument();
    socketState.connected = true; // restore for other tests
  });

  it('passes the live `enabled` flag through to the publisher hook', async () => {
    const user = userEvent.setup();
    storeState.sharingCrewId = CREW_ID;
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    // Initially disabled.
    expect(publisherSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, crewId: CREW_ID }));
    await user.click(screen.getByRole('switch'));
    expect(publisherSpy).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
  });
});

describe('LiveLocationControls — SOS raise dialog', () => {
  it('opens a confirm dialog before sending (guards accidental triggers)', async () => {
    const user = userEvent.setup();
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('button', { name: /raise an sos/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/raise an sos\?/i)).toBeInTheDocument();
    // It must NOT have posted yet — only on explicit confirm.
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('POSTs the SOS (with optional message) and toasts success on confirm', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({});
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('button', { name: /raise an sos/i }));
    await user.type(screen.getByLabelText(/optional sos message/i), 'Lost near Main Stage');
    await user.click(screen.getByRole('button', { name: /send sos/i }));

    expect(apiPost).toHaveBeenCalledWith(`/crews/${CREW_ID}/sos`, { message: 'Lost near Main Stage' });
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/sos sent/i), 'success');
  });

  it('tells the user explicitly when the SOS fails (online-only, never silent)', async () => {
    const user = userEvent.setup();
    apiPost.mockRejectedValueOnce(new Error('offline'));
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    await user.click(screen.getByRole('button', { name: /raise an sos/i }));
    await user.click(screen.getByRole('button', { name: /send sos/i }));

    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/SOS not sent/i), 'error');
  });
});

describe('LiveLocationControls — active SOS banner', () => {
  const baseSos = {
    crewId: CREW_ID,
    userId: 'user-other',
    username: 'Dana',
    message: 'Need help at the gate',
    raisedAt: new Date().toISOString(),
  };

  it('renders a prominent alert banner for a crew SOS raised by someone else', () => {
    storeState.sos = { ...baseSos };
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    const banner = screen.getByTestId('sos-banner');
    expect(banner).toHaveAttribute('role', 'alert');
    expect(within(banner).getByText(/Dana raised an SOS/i)).toBeInTheDocument();
    expect(within(banner).getByText('Need help at the gate')).toBeInTheDocument();
    // Not mine → no clear control (only the raiser may dismiss).
    expect(within(banner).queryByRole('button', { name: /clear sos/i })).not.toBeInTheDocument();
  });

  it('only shows the "I\'m safe — clear SOS" action to the raiser', async () => {
    const user = userEvent.setup();
    apiPost.mockResolvedValueOnce({});
    storeState.sos = { ...baseSos, userId: ME, username: 'Me' };
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    const banner = screen.getByTestId('sos-banner');
    expect(within(banner).getByText(/you raised an sos/i)).toBeInTheDocument();
    const clearBtn = within(banner).getByRole('button', { name: /clear sos/i });

    await user.click(clearBtn);

    expect(apiPost).toHaveBeenCalledWith(`/crews/${CREW_ID}/sos/clear`, {});
    // Optimistic local clear so the banner dismisses immediately.
    expect(clearSosSpy).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(expect.stringMatching(/sos cleared/i), 'success');
  });

  it('offers a directions link when the SOS carries a position', () => {
    storeState.sos = { ...baseSos, position: { lat: 41.88, lng: -87.62, capturedAt: new Date().toISOString() } };
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);

    expect(
      within(screen.getByTestId('sos-banner')).getByRole('button', { name: /get directions/i }),
    ).toBeInTheDocument();
  });

  it('ignores an SOS targeting a different crew', () => {
    storeState.sos = { ...baseSos, crewId: 'other-crew' };
    render(<LiveLocationControls crewId={CREW_ID} currentUserId={ME} />);
    expect(screen.queryByTestId('sos-banner')).not.toBeInTheDocument();
  });
});

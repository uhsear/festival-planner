import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---

vi.mock('lucide-react', () => ({
  MapPin: () => <span data-testid="map-pin-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  X: () => <span data-testid="x-icon" />,
  Navigation: () => <span data-testid="navigation-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  Loader: () => <span data-testid="loader-icon" />,
  Check: () => <span data-testid="check-icon" />,
  // List/Map view toggle.
  Map: () => <span data-testid="map-icon" />,
  List: () => <span data-testid="list-icon" />,
  // 055: daily-recurrence toggle + badge.
  Repeat: () => <span data-testid="repeat-icon" />,
  // CrewStatus (rendered by MeetingPointsTab) pulls these too.
  LocateFixed: () => <span data-testid="locate-fixed-icon" />,
  Footprints: () => <span data-testid="footprints-icon" />,
  CircleCheck: () => <span data-testid="circle-check-icon" />,
  Hourglass: () => <span data-testid="hourglass-icon" />,
}));

// api is unused in assertions (the mutation fns are what we check), but the
// component imports it at module load — provide a stub. Inlined to avoid the
// hoisting trap (vi.mock factories run before top-level consts initialize).
// MeetingPointsTab renders <CrewStatus/> (M5), which reads useCrewStore and
// calls formatStaleness/etaMinutes from @festie/shared. The store has no rows
// in these tests (CrewStatus renders only its header/banner), so a minimal
// selector-backed stub keeps this suite focused on meeting-point behavior.
vi.mock('@festie/shared', () => {
  const crewState = {
    crewStatuses: [] as unknown[],
    loadStatuses: vi.fn(async () => {}),
    updateMyStatus: vi.fn(async () => {}),
  };
  return {
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
    useCrewStore: (selector: (s: typeof crewState) => unknown) => selector(crewState),
    formatStaleness: () => 'just now',
    etaMinutes: () => 0,
    // 055: recurring-point badge. Mirror the real helper's recurring shape
    // ("daily <time>") so the component's `.replace(/^daily /, '')` yields the
    // time-of-day rendered after "Daily · ".
    meetingTimeDisplay: () => ({ label: 'daily 3:00 PM', recurring: true, next: null }),
    resolveFestivalTimeZone: () => undefined,
  };
});

// MeetingPointsTab reads the festival timezone + days from the festival store to
// render recurring-point badges in the festival frame. The list tests don't care
// about the value, so a null festival / empty days is enough.
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (selector: (s: { currentFestival: unknown; days: unknown[] }) => unknown) =>
    selector({ currentFestival: null, days: [] }),
}));

vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// react-query: drive useQuery state + capture mutations so we can assert the
// component calls .mutate() with the right payloads. Each useMutation call is
// keyed by call order in the component (create, update, remove). These live in
// vi.hoisted() so the (hoisted) vi.mock factory can reference them safely.
const { mockInvalidateQueries, createMutate, updateMutate, removeMutate, mockRefetch, rq } = vi.hoisted(() => {
  const create = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();
  return {
    mockInvalidateQueries: vi.fn(),
    createMutate: create,
    updateMutate: update,
    removeMutate: remove,
    mockRefetch: vi.fn(),
    // Per-render counter: useQueryClient runs once before the three useMutation
    // calls, so reset there to keep create/update/remove ordering stable.
    rq: { idx: 0, fns: [create, update, remove] },
  };
});

let queryState: { data: unknown; isLoading: boolean; isError: boolean };

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => {
    rq.idx = 0;
    return { invalidateQueries: mockInvalidateQueries };
  },
  useQuery: () => ({ ...queryState, refetch: mockRefetch }),
  useMutation: () => {
    const mutate = rq.fns[rq.idx % rq.fns.length];
    rq.idx += 1;
    return { mutate, isPending: false };
  },
}));

import MeetingPointsTab from './MeetingPointsTab';

const POINT = {
  id: 'mp1',
  crew_id: 'c1',
  created_by: 'u1',
  label: 'Main Entrance',
  location: 'By the front gate',
  type: 'during' as const,
  meet_at: null,
  stage_reference: 'Main Stage',
  active: true,
  created_at: '2026-06-01T00:00:00Z',
};

function setQuery(overrides: Partial<typeof queryState> = {}) {
  queryState = { data: [], isLoading: false, isError: false, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  setQuery();
});

describe('MeetingPointsTab', () => {
  it('renders the loading skeleton state', () => {
    setQuery({ isLoading: true });
    const { container } = render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    // No "Add Meeting Point" button while loading.
    expect(screen.queryByRole('button', { name: /add meeting point/i })).not.toBeInTheDocument();
    expect(container.querySelector('.px-4')).toBeInTheDocument();
  });

  it('renders the error state with a Retry action', async () => {
    const user = userEvent.setup();
    setQuery({ isError: true });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.getByText("Couldn't load meeting points")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state when there are no points', () => {
    setQuery({ data: [] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.getByText('No meeting points yet')).toBeInTheDocument();
  });

  it('renders the points list', () => {
    setQuery({ data: [POINT] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.getByText('Main Entrance')).toBeInTheDocument();
    expect(screen.getByText('By the front gate')).toBeInTheDocument();
  });

  it('renders "Near <stage>" and a directions button when stage_reference/location present', () => {
    setQuery({ data: [POINT] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.getByText('Near Main Stage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Directions to Main Entrance' })).toBeInTheDocument();
  });

  it('opens Google Maps when the directions button is clicked', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    setQuery({ data: [POINT] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    await user.click(screen.getByRole('button', { name: 'Directions to Main Entrance' }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining('maps.google.com'), '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('"Add Meeting Point" button opens the create form', async () => {
    const user = userEvent.setup();
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    await user.click(screen.getByRole('button', { name: /add meeting point/i }));
    expect(screen.getByText('New Meeting Point')).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toBeInTheDocument();
  });

  it('disables submit until both required fields (label + location) are filled', async () => {
    const user = userEvent.setup();
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    await user.click(screen.getByRole('button', { name: /add meeting point/i }));

    const submit = screen.getByRole('button', { name: 'Add' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Label'), 'Entrance');
    expect(submit).toBeDisabled(); // location still empty

    await user.type(screen.getByLabelText('Location'), 'Front gate');
    expect(submit).not.toBeDisabled();
  });

  it('submitting the create form calls the create mutation with the payload', async () => {
    const user = userEvent.setup();
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    await user.click(screen.getByRole('button', { name: /add meeting point/i }));

    await user.type(screen.getByLabelText('Label'), 'Entrance');
    await user.type(screen.getByLabelText('Location'), 'Front gate');
    await user.type(screen.getByLabelText('Near stage'), 'Main Stage');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Entrance',
        location: 'Front gate',
        type: 'during',
        stageReference: 'Main Stage',
      }),
    );
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('edit button populates the form and submitting triggers the update mutation', async () => {
    const user = userEvent.setup();
    setQuery({ data: [POINT] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);

    await user.click(screen.getByRole('button', { name: 'Edit meeting point' }));

    // Form is pre-filled from the point.
    expect(screen.getByText('Edit Meeting Point')).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toHaveValue('Main Entrance');
    expect(screen.getByLabelText('Location')).toHaveValue('By the front gate');
    expect(screen.getByLabelText('Near stage')).toHaveValue('Main Stage');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'mp1',
        payload: expect.objectContaining({ label: 'Main Entrance', location: 'By the front gate' }),
      }),
    );
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('delete button triggers the remove mutation with the point id', async () => {
    const user = userEvent.setup();
    setQuery({ data: [POINT] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    await user.click(screen.getByRole('button', { name: 'Remove meeting point' }));
    expect(removeMutate).toHaveBeenCalledWith('mp1');
  });

  it('hides edit/remove controls for points the user did not create', () => {
    setQuery({ data: [{ ...POINT, created_by: 'someone-else' }] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.queryByRole('button', { name: 'Edit meeting point' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove meeting point' })).not.toBeInTheDocument();
    // Directions still available to everyone.
    expect(screen.getByRole('button', { name: 'Directions to Main Entrance' })).toBeInTheDocument();
  });

  it('does not render "Near" when stage_reference is absent', () => {
    setQuery({ data: [{ ...POINT, stage_reference: null }] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.queryByText(/^Near /)).not.toBeInTheDocument();
  });

  it('scopes a single rendered point card with its label and location', () => {
    setQuery({ data: [POINT] });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    const label = screen.getByText('Main Entrance');
    const card = label.closest('div.p-3') as HTMLElement;
    expect(within(card).getByText('By the front gate')).toBeInTheDocument();
  });

  it('renders a "Daily · <time>" badge for a recurring timed point', () => {
    setQuery({
      data: [{ ...POINT, meet_at: '2026-06-14T15:00:00Z', recurs_daily: true }],
    });
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    expect(screen.getByText('Daily · 3:00 PM')).toBeInTheDocument();
  });

  it('shows the "Repeats daily" toggle only once a meet time is set, and rides it into the create payload', async () => {
    const user = userEvent.setup();
    render(<MeetingPointsTab crewId="c1" currentUserId="u1" />);
    await user.click(screen.getByRole('button', { name: /add meeting point/i }));

    await user.type(screen.getByLabelText('Label'), 'Entrance');
    await user.type(screen.getByLabelText('Location'), 'Front gate');

    // No meet time yet → no recurrence toggle.
    expect(screen.queryByRole('switch', { name: /repeats daily/i })).not.toBeInTheDocument();

    // datetime-local accepts a "YYYY-MM-DDTHH:mm" value directly.
    const meetAt = screen.getByLabelText('Meet at time');
    await user.type(meetAt, '2026-06-14T15:00');

    const toggle = screen.getByRole('switch', { name: /repeats daily/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(createMutate).toHaveBeenCalledWith(expect.objectContaining({ recursDaily: true }));
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---

vi.mock('lucide-react', () => ({
  SlidersHorizontal: () => <span data-testid="sliders-icon" />,
}));

// The store is consumed via selectors: useNotificationPrefsStore((s) => s.x).
// We hold a mutable state object and run the selector against it, mirroring the
// real zustand store surface (prefs / loadPrefs / updatePrefs / isLoading / error).
const mockLoadPrefs = vi.fn().mockResolvedValue(undefined);
const mockUpdatePrefs = vi.fn().mockResolvedValue(undefined);

let storeState: Record<string, unknown>;

function resetStore(overrides: Record<string, unknown> = {}) {
  storeState = {
    prefs: {
      crewUpdates: true,
      setReminders: true,
      scheduleChanges: true,
      dndStart: null,
      dndEnd: null,
    },
    loaded: false,
    isLoading: false,
    error: null,
    loadPrefs: mockLoadPrefs,
    updatePrefs: mockUpdatePrefs,
    ...overrides,
  };
}

vi.mock('@festie/shared/stores', () => ({
  useNotificationPrefsStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

import NotificationPrefsSection from './NotificationPrefsSection';

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadPrefs.mockResolvedValue(undefined);
  mockUpdatePrefs.mockResolvedValue(undefined);
  resetStore();
});

describe('NotificationPrefsSection', () => {
  it('renders the heading and all toggle switches', () => {
    render(<NotificationPrefsSection />);
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Crew updates' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Schedule changes' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeInTheDocument();
  });

  it('loads prefs on mount', () => {
    render(<NotificationPrefsSection />);
    expect(mockLoadPrefs).toHaveBeenCalledTimes(1);
  });

  it('reflects current pref values via aria-checked', () => {
    resetStore({
      prefs: {
        crewUpdates: false,
        setReminders: true,
        scheduleChanges: false,
        dndStart: null,
        dndEnd: null,
      },
    });
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Crew updates' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Schedule changes' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls updatePrefs to turn OFF an enabled toggle', async () => {
    const user = userEvent.setup();
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Set reminders' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ setReminders: false });
  });

  it('calls updatePrefs to turn ON a disabled toggle', async () => {
    const user = userEvent.setup();
    resetStore({
      prefs: {
        crewUpdates: false,
        setReminders: true,
        scheduleChanges: true,
        dndStart: null,
        dndEnd: null,
      },
    });
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Crew updates' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ crewUpdates: true });
  });

  it('shows quiet hours OFF when no DND window is set', () => {
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Mute 11pm–8am')).toBeInTheDocument();
  });

  it('shows quiet hours ON when a DND window is set', () => {
    resetStore({
      prefs: {
        crewUpdates: true,
        setReminders: true,
        scheduleChanges: true,
        dndStart: '23:00',
        dndEnd: '08:00',
      },
    });
    render(<NotificationPrefsSection />);
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toHaveAttribute('aria-checked', 'true');
  });

  it('enabling quiet hours sends a DND start/end window to updatePrefs', async () => {
    const user = userEvent.setup();
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: '23:00', dndEnd: '08:00' });
  });

  it('disabling quiet hours clears the DND window via updatePrefs', async () => {
    const user = userEvent.setup();
    resetStore({
      prefs: {
        crewUpdates: true,
        setReminders: true,
        scheduleChanges: true,
        dndStart: '23:00',
        dndEnd: '08:00',
      },
    });
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    expect(mockUpdatePrefs).toHaveBeenCalledWith({ dndStart: null, dndEnd: null });
  });

  it('renders without crashing in the loading state', () => {
    resetStore({ isLoading: true });
    render(<NotificationPrefsSection />);
    // Toggles still render while a background load is in flight.
    expect(screen.getByRole('switch', { name: 'Set reminders' })).toBeInTheDocument();
  });

  it('renders without crashing in an error state', () => {
    resetStore({ error: 'Failed to load notification settings' });
    render(<NotificationPrefsSection />);
    expect(screen.getByText('Notification types')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Crew updates' })).toBeInTheDocument();
  });

  it('does not throw if updatePrefs rejects (failure is swallowed)', async () => {
    const user = userEvent.setup();
    mockUpdatePrefs.mockRejectedValue(new Error('network'));
    render(<NotificationPrefsSection />);
    await user.click(screen.getByRole('switch', { name: 'Schedule changes' }));
    await waitFor(() => expect(mockUpdatePrefs).toHaveBeenCalledWith({ scheduleChanges: false }));
    // No unhandled rejection / thrown error reaching the test.
    expect(screen.getByText('Notification types')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingSyncSheet from './PendingSyncSheet';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { FailedSyncItem } from '@festie/shared/stores/uiStore';

const dismissFailedSync = vi.fn();
const clearFailedSync = vi.fn();

interface MockState {
  failedSync: FailedSyncItem[];
  dismissFailedSync: typeof dismissFailedSync;
  clearFailedSync: typeof clearFailedSync;
}

vi.mock('@festie/shared/stores/uiStore', () => {
  const mockStore = vi.fn();
  (mockStore as unknown as { getState: () => unknown }).getState = () => ({
    dismissFailedSync,
    clearFailedSync,
  });
  return { useUIStore: mockStore };
});

function setStoreState(failedSync: FailedSyncItem[]) {
  const state: MockState = { failedSync, dismissFailedSync, clearFailedSync };
  vi.mocked(useUIStore).mockImplementation((selector: (s: typeof state) => unknown) => selector(state) as never);
  (useUIStore as unknown as { getState: () => unknown }).getState = () => state;
}

function item(overrides: Partial<FailedSyncItem> = {}): FailedSyncItem {
  return {
    clientId: 'c1',
    label: 'Add poll',
    method: 'POST',
    url: '/crews/x/polls',
    body: { question: 'pizza?' },
    error: 'Conflict',
    at: Date.now(),
    ...overrides,
  };
}

describe('PendingSyncSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as Record<string, unknown>).__festieQueue = undefined;
  });

  it('renders nothing and closes when there are no failed items', () => {
    const onClose = vi.fn();
    setStoreState([]);
    const { container } = render(<PendingSyncSheet onClose={onClose} />);
    expect(container.firstChild).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('lists each failed item with its label and error', () => {
    setStoreState([item({ label: 'Add meeting point', error: 'Conflict' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add meeting point')).toBeInTheDocument();
    expect(screen.getByText('Conflict')).toBeInTheDocument();
  });

  it('dismisses a single item via its Dismiss button', async () => {
    const user = userEvent.setup();
    setStoreState([item({ clientId: 'abc' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    await user.click(screen.getByText('Dismiss'));
    expect(dismissFailedSync).toHaveBeenCalledWith('abc');
  });

  it('re-enqueues via window.__festieQueue on Retry', async () => {
    const user = userEvent.setup();
    const queueMutation = vi.fn().mockResolvedValue('abc');
    const processQueue = vi.fn().mockResolvedValue(undefined);
    (window as Record<string, unknown>).__festieQueue = { queueMutation, processQueue };
    setStoreState([item({ clientId: 'abc', url: '/crews/x/polls', method: 'POST' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    await user.click(screen.getByText('Retry'));
    expect(queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'api', clientId: 'abc', url: '/crews/x/polls', method: 'POST' }),
    );
    // It optimistically drops the item from the failed list.
    expect(dismissFailedSync).toHaveBeenCalledWith('abc');
  });

  it('clears all items via Dismiss all', async () => {
    const user = userEvent.setup();
    setStoreState([item({ clientId: 'a' }), item({ clientId: 'b' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    await user.click(screen.getByText('Dismiss all'));
    expect(clearFailedSync).toHaveBeenCalled();
  });
});

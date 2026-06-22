import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LowPowerToggle from './LowPowerToggle';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';

const { toggleSpy, selectSpy } = vi.hoisted(() => ({ toggleSpy: vi.fn(), selectSpy: vi.fn() }));

vi.mock('@festie/shared/stores/festivalModeStore', () => {
  const state = { lowPowerMode: false, toggleLowPowerMode: toggleSpy };
  return { useFestivalModeStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});
vi.mock('../../hooks/useHaptics', () => ({ useHaptics: () => ({ select: selectSpy }) }));
vi.mock('lucide-react', () => ({ BatteryLow: () => <span data-testid="battery-icon" /> }));

function setLowPower(lowPowerMode: boolean) {
  vi.mocked(useFestivalModeStore).mockImplementation(
    (sel: (s: { lowPowerMode: boolean; toggleLowPowerMode: () => void }) => unknown) =>
      sel({ lowPowerMode, toggleLowPowerMode: toggleSpy }) as never,
  );
}

describe('LowPowerToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLowPower(false);
  });

  it('renders a switch reflecting the off state', () => {
    render(<LowPowerToggle />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Festival low-power mode')).toBeInTheDocument();
  });

  it('reflects the on state from the store', () => {
    setLowPower(true);
    render(<LowPowerToggle />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls toggleLowPowerMode when clicked', async () => {
    const user = userEvent.setup();
    render(<LowPowerToggle />);
    await user.click(screen.getByRole('switch'));
    expect(toggleSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });
});

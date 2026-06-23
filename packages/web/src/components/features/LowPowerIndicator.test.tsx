import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LowPowerIndicator from './LowPowerIndicator';
import { useFestivalModeStore } from '@festie/shared/stores/festivalModeStore';

vi.mock('@festie/shared/stores/festivalModeStore', () => {
  const state = { lowPowerMode: false };
  return { useFestivalModeStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});
vi.mock('lucide-react', () => ({ BatteryLow: () => <span data-testid="battery-icon" /> }));

function setLowPower(lowPowerMode: boolean) {
  vi.mocked(useFestivalModeStore).mockImplementation(
    (sel: (s: { lowPowerMode: boolean }) => unknown) => sel({ lowPowerMode }) as never,
  );
}

describe('LowPowerIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLowPower(false);
  });

  it('renders nothing when low-power mode is off', () => {
    setLowPower(false);
    const { container } = render(<LowPowerIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the "Low power" pill when active', () => {
    setLowPower(true);
    render(<LowPowerIndicator />);
    expect(screen.getByTestId('low-power-indicator')).toHaveTextContent('Low power');
  });
});

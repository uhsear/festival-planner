import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Crew } from '@festie/shared/types';

// Mock useHaptics
vi.mock('@/hooks/useHaptics', () => ({
  useHaptics: vi.fn(() => ({ tap: vi.fn(), select: vi.fn() })),
}));

import CrewSelector from './CrewSelector';

const makeCrew = (overrides: Partial<Crew> = {}): Crew => ({
  id: 'crew-1',
  name: 'Test Crew',
  owner: 'user-1',
  members: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('CrewSelector', () => {
  const defaultProps = {
    crews: [
      makeCrew({ id: 'crew-1', name: 'Alpha Crew' }),
      makeCrew({ id: 'crew-2', name: 'Beta Squad' }),
    ],
    selectedCrewId: 'crew-1',
    onSelectCrew: vi.fn(),
    onCreateCrew: vi.fn(),
    onJoinCrew: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the select crew trigger button', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.getByLabelText('Select crew')).toBeInTheDocument();
  });

  it('shows selected crew name in the trigger', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.getByText('Alpha Crew')).toBeInTheDocument();
  });

  it('shows "Select Crew" when no crews match selectedCrewId', () => {
    render(<CrewSelector {...defaultProps} crews={[]} selectedCrewId={undefined} />);
    expect(screen.getByText('Select Crew')).toBeInTheDocument();
  });

  it('starts collapsed (listbox not visible)', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('expands on click to show crew list', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByLabelText('Select crew'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Alpha Crew/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Beta Squad/ })).toBeInTheDocument();
  });

  it('marks selected crew with aria-selected', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByLabelText('Select crew'));
    expect(screen.getByRole('option', { name: /Alpha Crew/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /Beta Squad/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelectCrew and closes when a crew is selected', async () => {
    const onSelectCrew = vi.fn();
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} onSelectCrew={onSelectCrew} />);
    await user.click(screen.getByLabelText('Select crew'));
    await user.click(screen.getByRole('option', { name: /Beta Squad/ }));
    expect(onSelectCrew).toHaveBeenCalledWith('crew-2');
    // Panel should close after selection
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders Create Crew and Join by Code buttons in the dropdown', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    await user.click(screen.getByLabelText('Select crew'));
    expect(screen.getByRole('button', { name: /Create Crew/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Join by Code/ })).toBeInTheDocument();
  });

  it('calls onCreateCrew and closes when Create Crew is clicked', async () => {
    const onCreateCrew = vi.fn();
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} onCreateCrew={onCreateCrew} />);
    await user.click(screen.getByLabelText('Select crew'));
    await user.click(screen.getByRole('button', { name: /Create Crew/ }));
    expect(onCreateCrew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('calls onJoinCrew and closes when Join by Code is clicked', async () => {
    const onJoinCrew = vi.fn();
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} onJoinCrew={onJoinCrew} />);
    await user.click(screen.getByLabelText('Select crew'));
    await user.click(screen.getByRole('button', { name: /Join by Code/ }));
    expect(onJoinCrew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('sets aria-expanded correctly on the trigger button', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    const trigger = screen.getByLabelText('Select crew');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('has aria-haspopup=listbox on the trigger', () => {
    render(<CrewSelector {...defaultProps} />);
    expect(screen.getByLabelText('Select crew')).toHaveAttribute('aria-haspopup', 'listbox');
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    const trigger = screen.getByLabelText('Select crew');
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('toggles closed on second click', async () => {
    const user = userEvent.setup();
    render(<CrewSelector {...defaultProps} />);
    const trigger = screen.getByLabelText('Select crew');
    await user.click(trigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CrewTotemCard from './CrewTotemCard';
import { useCrewStore } from '@festie/shared/stores/crewStore';

const { updateCrewSpy, toastSpy } = vi.hoisted(() => ({
  updateCrewSpy: vi.fn().mockResolvedValue(undefined),
  toastSpy: vi.fn(),
}));

vi.mock('@festie/shared/stores/crewStore', () => {
  const state = { updateCrew: updateCrewSpy };
  return { useCrewStore: vi.fn((sel: (s: typeof state) => unknown) => sel(state)) };
});
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('../ui/Button', () => ({
  default: ({ children, onClick, ...rest }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));
vi.mock('../ui/IconButton', () => ({
  default: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button aria-label={label} onClick={onClick} />
  ),
}));
vi.mock('lucide-react', () => ({
  Flag: () => <span data-testid="flag-icon" />,
  X: () => <span data-testid="x-icon" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCrewStore).mockImplementation(
    (sel: (s: { updateCrew: typeof updateCrewSpy }) => unknown) => sel({ updateCrew: updateCrewSpy }) as never,
  );
});

describe('CrewTotemCard', () => {
  it('shows the totem emoji + name prominently for find-your-crew', () => {
    render(<CrewTotemCard crewId="c1" totemName="Flamingo Flag" totemEmoji="🦩" isOwner={false} />);
    const card = screen.getByTestId('crew-totem-card');
    expect(card).toHaveTextContent('🦩');
    expect(card).toHaveTextContent('Flamingo Flag');
    expect(card).toHaveTextContent('Find your crew');
  });

  it('hides entirely for a non-owner when there is no totem', () => {
    const { container } = render(<CrewTotemCard crewId="c1" totemName={null} totemEmoji={null} isOwner={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('lets an owner with no totem open the editor', () => {
    render(<CrewTotemCard crewId="c1" totemName={null} totemEmoji={null} isOwner />);
    expect(screen.getByText('Tap to set your crew totem')).toBeInTheDocument();
  });

  it('saves totemName + totemEmoji via updateCrew when an owner edits', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<CrewTotemCard crewId="c1" totemName={null} totemEmoji={null} isOwner onSaved={onSaved} />);

    // Open the editor.
    await user.click(screen.getByTestId('crew-totem-card'));

    await user.type(screen.getByLabelText('Totem name'), 'Disco Ball');
    await user.type(screen.getByLabelText('Totem emoji'), '🪩');
    await user.click(screen.getByText('Save totem'));

    expect(updateCrewSpy).toHaveBeenCalledWith('c1', { totemName: 'Disco Ball', totemEmoji: '🪩' });
  });

  it('does not open the editor for a non-owner', async () => {
    const user = userEvent.setup();
    render(<CrewTotemCard crewId="c1" totemName="Flag" totemEmoji="🚩" isOwner={false} />);
    await user.click(screen.getByTestId('crew-totem-card'));
    expect(screen.queryByLabelText('Totem name')).not.toBeInTheDocument();
  });
});

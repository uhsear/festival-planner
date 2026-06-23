import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DetailNotesSection from './DetailNotesSection';

describe('DetailNotesSection', () => {
  const defaultProps = {
    personalNote: '',
    crewNote: '',
    onPersonalChange: vi.fn(),
    onCrewChange: vi.fn(),
  };

  it('renders personal notes section', () => {
    render(<DetailNotesSection {...defaultProps} />);
    expect(screen.getByText('Personal Notes')).toBeInTheDocument();
  });

  it('renders crew notes section', () => {
    render(<DetailNotesSection {...defaultProps} />);
    expect(screen.getByText('Crew Note (visible to your crew)')).toBeInTheDocument();
  });

  it('displays personal note value', () => {
    render(
      <DetailNotesSection {...defaultProps} personalNote="Meet at the rail" />,
    );
    const textarea = screen.getByLabelText('Personal Notes');
    expect(textarea).toHaveValue('Meet at the rail');
  });

  it('displays crew note value', () => {
    render(
      <DetailNotesSection {...defaultProps} crewNote="VIP area" />,
    );
    const textarea = screen.getByLabelText('Crew Note (visible to your crew)');
    expect(textarea).toHaveValue('VIP area');
  });

  it('calls onPersonalChange when personal note is typed', async () => {
    const user = userEvent.setup();
    const onPersonalChange = vi.fn();
    render(
      <DetailNotesSection {...defaultProps} onPersonalChange={onPersonalChange} />,
    );
    const textarea = screen.getByLabelText('Personal Notes');
    await user.type(textarea, 'a');
    expect(onPersonalChange).toHaveBeenCalledWith('a');
  });

  it('calls onCrewChange when crew note is typed', async () => {
    const user = userEvent.setup();
    const onCrewChange = vi.fn();
    render(
      <DetailNotesSection {...defaultProps} onCrewChange={onCrewChange} />,
    );
    const textarea = screen.getByLabelText('Crew Note (visible to your crew)');
    await user.type(textarea, 'b');
    expect(onCrewChange).toHaveBeenCalledWith('b');
  });

  it('renders placeholder text for personal notes', () => {
    render(<DetailNotesSection {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Add notes/);
    expect(textarea).toBeInTheDocument();
  });

  it('renders placeholder text for crew notes', () => {
    render(<DetailNotesSection {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(/Share a note with your crew/);
    expect(textarea).toBeInTheDocument();
  });
});

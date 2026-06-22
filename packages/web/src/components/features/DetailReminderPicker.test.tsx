import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DetailReminderPicker from './DetailReminderPicker';

describe('DetailReminderPicker', () => {
  const onReminderClick = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all reminder option labels', () => {
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={null} onReminderClick={onReminderClick} />);
    expect(screen.getByText('5m')).toBeInTheDocument();
    expect(screen.getByText('10m')).toBeInTheDocument();
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('30m')).toBeInTheDocument();
    expect(screen.getByText('1h')).toBeInTheDocument();
  });

  it('calls onReminderClick with the correct minute value when an option is clicked', async () => {
    const user = userEvent.setup();
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={null} onReminderClick={onReminderClick} />);
    await user.click(screen.getByRole('button', { name: 'Remind me 15m before' }));
    expect(onReminderClick).toHaveBeenCalledWith(15);
  });

  it('clears the reminder (calls with null) when the active option is clicked', async () => {
    const user = userEvent.setup();
    render(<DetailReminderPicker myReminder={30} reminderBusy={null} onReminderClick={onReminderClick} />);
    // The active option exposes a "click to clear" aria-label.
    await user.click(screen.getByRole('button', { name: 'Reminder 30m before, click to clear' }));
    expect(onReminderClick).toHaveBeenCalledWith(null);
  });

  it('disables all buttons while a reminder action is busy', () => {
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={10} onReminderClick={onReminderClick} />);
    for (const btn of screen.getAllByRole('button')) {
      expect(btn).toBeDisabled();
    }
  });

  it('does not invoke onReminderClick when a busy button is clicked', async () => {
    const user = userEvent.setup();
    render(<DetailReminderPicker myReminder={undefined} reminderBusy={10} onReminderClick={onReminderClick} />);
    await user.click(screen.getByText('5m'));
    expect(onReminderClick).not.toHaveBeenCalled();
  });

  it('applies active styling and aria-pressed to the matching option', () => {
    render(<DetailReminderPicker myReminder={60} reminderBusy={null} onReminderClick={onReminderClick} />);
    const active = screen.getByRole('button', { name: 'Reminder 1h before, click to clear' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active.className).toContain('border-accent-aqua');

    const inactive = screen.getByRole('button', { name: 'Remind me 5m before' });
    expect(inactive).toHaveAttribute('aria-pressed', 'false');
    expect(inactive.className).not.toContain('border-accent-aqua');
  });
});

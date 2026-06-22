import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExpenseItem, { type ExpenseItemProps } from './ExpenseItem';

const foodCategory = { key: 'food', emoji: '🍔', label: 'Food' };
const transportCategory = { key: 'transport', emoji: '🚗', label: 'Transport' };

function makeProps(overrides: Partial<ExpenseItemProps> = {}): ExpenseItemProps {
  return {
    id: 'exp-1',
    description: 'Pizza for the crew',
    amount: 45.5,
    paidByName: 'Alice',
    paidByMe: false,
    splitCount: 4,
    category: foodCategory,
    onRemove: vi.fn(),
    isRemoving: false,
    ...overrides,
  };
}

describe('ExpenseItem', () => {
  it('renders the description', () => {
    render(<ExpenseItem {...makeProps()} />);
    expect(screen.getByText('Pizza for the crew')).toBeInTheDocument();
  });

  it('renders the category emoji', () => {
    render(<ExpenseItem {...makeProps()} />);
    expect(screen.getByText('🍔')).toBeInTheDocument();
  });

  it('formats numeric amount to two decimal places', () => {
    render(<ExpenseItem {...makeProps({ amount: 45.5 })} />);
    expect(screen.getByText(/\$45\.50/)).toBeInTheDocument();
  });

  it('formats string amount to two decimal places', () => {
    render(<ExpenseItem {...makeProps({ amount: '100' })} />);
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });

  it('handles amount with many decimals', () => {
    render(<ExpenseItem {...makeProps({ amount: 33.333 })} />);
    expect(screen.getByText(/\$33\.33/)).toBeInTheDocument();
  });

  it('shows payer name when someone else paid', () => {
    render(<ExpenseItem {...makeProps({ paidByMe: false, paidByName: 'Bob' })} />);
    expect(screen.getByText(/Bob paid/)).toBeInTheDocument();
  });

  it('shows "You" when the current user paid', () => {
    render(<ExpenseItem {...makeProps({ paidByMe: true })} />);
    expect(screen.getByText(/You paid/)).toBeInTheDocument();
  });

  it('displays split count when greater than zero', () => {
    render(<ExpenseItem {...makeProps({ splitCount: 3 })} />);
    expect(screen.getByText(/split 3 ways/)).toBeInTheDocument();
  });

  it('hides split info when splitCount is zero', () => {
    render(<ExpenseItem {...makeProps({ splitCount: 0 })} />);
    expect(screen.queryByText(/split/)).not.toBeInTheDocument();
  });

  it('shows remove button only when paidByMe is true', () => {
    render(<ExpenseItem {...makeProps({ paidByMe: true })} />);
    expect(screen.getByRole('button', { name: 'Remove expense' })).toBeInTheDocument();
  });

  it('hides remove button when paidByMe is false', () => {
    render(<ExpenseItem {...makeProps({ paidByMe: false })} />);
    expect(screen.queryByRole('button', { name: 'Remove expense' })).not.toBeInTheDocument();
  });

  it('calls onRemove with the expense id when remove is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<ExpenseItem {...makeProps({ paidByMe: true, id: 'exp-42', onRemove })} />);
    await user.click(screen.getByRole('button', { name: 'Remove expense' }));
    expect(onRemove).toHaveBeenCalledWith('exp-42');
  });

  it('disables remove button when isRemoving is true', () => {
    render(<ExpenseItem {...makeProps({ paidByMe: true, isRemoving: true })} />);
    expect(screen.getByRole('button', { name: 'Remove expense' })).toBeDisabled();
  });

  it('renders with a different category', () => {
    render(<ExpenseItem {...makeProps({ category: transportCategory })} />);
    expect(screen.getByText('🚗')).toBeInTheDocument();
  });
});

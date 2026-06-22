import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompareCell from './CompareCell';

// CompareCell renders a <td>, so we need a <table> wrapper.
function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <tbody>
        <tr>{ui}</tr>
      </tbody>
    </table>,
  );
}

describe('CompareCell', () => {
  it('renders "Must" label for must priority', () => {
    renderInTable(<CompareCell priority="must" />);
    expect(screen.getByText('Must')).toBeInTheDocument();
  });

  it('renders "Want" label for want-to-see priority', () => {
    renderInTable(<CompareCell priority="want-to-see" />);
    expect(screen.getByText('Want')).toBeInTheDocument();
  });

  it('renders "Maybe" label for maybe priority', () => {
    renderInTable(<CompareCell priority="maybe" />);
    expect(screen.getByText('Maybe')).toBeInTheDocument();
  });

  it('renders dash when no priority', () => {
    renderInTable(<CompareCell priority={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders as a td element', () => {
    const { container } = renderInTable(<CompareCell priority="must" />);
    expect(container.querySelector('td')).toBeInTheDocument();
  });

  it('applies inline styles for priority colors', () => {
    renderInTable(<CompareCell priority="must" />);
    const span = screen.getByText('Must');
    expect(span.style.background).toBeTruthy();
    expect(span.style.color).toBeTruthy();
  });
});

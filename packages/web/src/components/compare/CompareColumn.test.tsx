import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CompareColumn from './CompareColumn';

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <thead>
        <tr>{ui}</tr>
      </thead>
    </table>,
  );
}

describe('CompareColumn', () => {
  it('renders "You" for the current user', () => {
    renderInTable(<CompareColumn id="me" name="Alice" isMe />);
    expect(screen.getByText('You')).toBeInTheDocument();
  });

  it('renders the name for other users', () => {
    renderInTable(<CompareColumn id="other" name="Bob" isMe={false} />);
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('falls back to "Member" when name is undefined for non-me', () => {
    renderInTable(<CompareColumn id="other" name={undefined} isMe={false} />);
    expect(screen.getByText('Member')).toBeInTheDocument();
  });

  it('renders as a th element', () => {
    const { container } = renderInTable(
      <CompareColumn id="me" name="Alice" isMe />,
    );
    expect(container.querySelector('th')).toBeInTheDocument();
  });

  it('renders an avatar component', () => {
    renderInTable(<CompareColumn id="me" name="Alice" isMe />);
    // Avatar renders the first letter of the name
    expect(screen.getByText('A')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MembersTab, { type MembersTabProps } from './MembersTab';

// Avatar depends on @festie/shared helpers — mock the module so tests
// don't need the full shared package wiring.
vi.mock('@festie/shared', () => ({
  getAvatarColor: () => '#888',
  getInitials: (name: string) => name.charAt(0).toUpperCase(),
  normalizeIdentityName: (name: string) => name,
}));

function makeProps(overrides: Partial<MembersTabProps> = {}): MembersTabProps {
  return {
    members: [
      { userId: 'u1', name: 'Alice', username: 'alice', role: 'owner' },
      { userId: 'u2', name: 'Bob', username: 'bob', role: 'member' },
      { userId: 'u3', name: 'Charlie', username: 'charlie' },
    ],
    ownerId: 'u1',
    isAdmin: false,
    adminAddBusy: false,
    onForceAdd: vi.fn(),
    ...overrides,
  };
}

describe('MembersTab', () => {
  it('renders all member names', () => {
    render(<MembersTab {...makeProps()} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('shows owner badge for members with role "owner"', () => {
    render(<MembersTab {...makeProps()} />);
    const ownerBadges = screen.getAllByText(/Owner/);
    expect(ownerBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows owner badge for member matching ownerId even without role', () => {
    const members = [
      { userId: 'u1', name: 'Alice', username: 'alice' }, // no role set
    ];
    render(<MembersTab {...makeProps({ members, ownerId: 'u1' })} />);
    expect(screen.getByText(/Owner/)).toBeInTheDocument();
  });

  it('does not show owner badge for regular members', () => {
    const members = [
      { userId: 'u2', name: 'Bob', username: 'bob', role: 'member' },
    ];
    render(<MembersTab {...makeProps({ members, ownerId: 'u1' })} />);
    expect(screen.queryByText(/Owner/)).not.toBeInTheDocument();
  });

  it('renders empty state when members list is empty', () => {
    render(<MembersTab {...makeProps({ members: [] })} />);
    expect(screen.getByText('No members yet')).toBeInTheDocument();
    expect(screen.getByText(/Invite friends/)).toBeInTheDocument();
  });

  it('hides admin force-add section for non-admin users', () => {
    render(<MembersTab {...makeProps({ isAdmin: false })} />);
    expect(screen.queryByText('Force Add')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows admin force-add section for admin users', () => {
    render(<MembersTab {...makeProps({ isAdmin: true })} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Force Add')).toBeInTheDocument();
  });

  it('calls onForceAdd when admin clicks Force Add', async () => {
    const user = userEvent.setup();
    const onForceAdd = vi.fn();
    render(<MembersTab {...makeProps({ isAdmin: true, onForceAdd })} />);
    await user.click(screen.getByText('Force Add'));
    expect(onForceAdd).toHaveBeenCalledOnce();
  });

  it('disables Force Add button when adminAddBusy is true', () => {
    render(<MembersTab {...makeProps({ isAdmin: true, adminAddBusy: true })} />);
    const btn = screen.getByRole('button', { name: /adding/i });
    expect(btn).toBeDisabled();
  });

  it('shows "Adding..." text when adminAddBusy is true', () => {
    render(<MembersTab {...makeProps({ isAdmin: true, adminAddBusy: true })} />);
    expect(screen.getByText('Adding…')).toBeInTheDocument();
  });

  it('falls back to username when name is missing', () => {
    const members = [
      { userId: 'u4', username: 'dave_99' },
    ];
    render(<MembersTab {...makeProps({ members, ownerId: undefined })} />);
    expect(screen.getByText('dave_99')).toBeInTheDocument();
  });
});

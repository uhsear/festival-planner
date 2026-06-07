import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import { SearchX } from 'lucide-react';

interface User {
  id: string;
  username: string;
  email: string;
  roles: string[];
  isVerified: boolean;
  createdAt: string;
}

/**
 * User management: list, search, admin toggle, deactivate
 */
export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    loadUsers();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadUsers = async () => {
    try {
      setLoading(true);
      const result = await api.get<User[]>('/admin/users');
      setUsers(Array.isArray(result) ? result : []);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't load users. Try again.", 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAdmin = async (userId: string, currentlyAdmin: boolean) => {
    try {
      if (currentlyAdmin) {
        await api.delete<void>(`/admin/users/${userId}/roles/admin`);
        setUsers(users.map((u) => (u.id === userId ? { ...u, roles: u.roles.filter((r) => r !== 'admin') } : u)));
      } else {
        await api.post<void>(`/admin/users/${userId}/roles`, { role: 'admin' });
        setUsers(users.map((u) => (u.id === userId ? { ...u, roles: [...u.roles, 'admin'] } : u)));
      }
      toast(`User ${!currentlyAdmin ? 'granted' : 'revoked'} admin access`, 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't update user. Try again.", 'error');
    }
  };

  const handleDelete = async (userId: string) => {
    const target = users.find((u) => u.id === userId);
    const name = target?.username || 'this user';
    if (
      !confirm(
        `Delete ${name}?\n\nThis permanently removes their account, picks, and crew memberships. This action cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      await api.delete<void>(`/admin/users/${userId}`);
      setUsers(users.filter((u) => u.id !== userId));
      toast(`Deleted ${name}`, 'success');
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't delete user. Try again.", 'error');
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading users…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="type-heading text-text-primary">Users ({filteredUsers.length})</h2>
      </div>

      <input
        type="text"
        placeholder="Search by username or email…"
        aria-label="Search users by username or email"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
      />

      {filteredUsers.length === 0 ? (
        <EmptyState
          icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
          title="No users found"
          description="Try adjusting your search query."
        />
      ) : (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
          {/* Table on lg+, stacked label/value cards below 1024px (§6 admin). */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm block lg:table">
              <caption className="sr-only">User management</caption>
              <thead className="hidden lg:table-header-group">
                <tr className="border-b border-glass-border bg-bg-primary/20">
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Username</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Email</th>
                  <th className="px-4 py-3 text-center text-text-muted font-medium">Verified</th>
                  <th className="px-4 py-3 text-center text-text-muted font-medium">Admin</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Joined</th>
                  <th className="px-4 py-3 text-right text-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="block lg:table-row-group lg:divide-y lg:divide-glass-border">
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="block lg:table-row mb-3 rounded-lg border border-glass-border bg-bg-card/40 p-2 last:mb-0 transition-colors hover:bg-bg-primary/20 lg:mb-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0"
                  >
                    <td
                      data-label="Username"
                      className="flex items-center justify-between gap-3 px-2 py-1.5 font-medium text-text-primary before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:before:content-none"
                    >
                      {user.username}
                    </td>
                    <td
                      data-label="Email"
                      className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs text-text-secondary before:text-sm before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:text-xs lg:before:content-none"
                    >
                      {user.email}
                    </td>
                    <td
                      data-label="Verified"
                      className="flex items-center justify-between gap-3 px-2 py-1.5 before:text-sm before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:text-center lg:before:content-none"
                    >
                      {user.isVerified ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-accent-green" title="Verified" />
                      ) : (
                        <span className="inline-block w-2 h-2 rounded-full bg-text-muted" title="Not verified" />
                      )}
                    </td>
                    <td
                      data-label="Admin"
                      className="flex items-center justify-between gap-3 px-2 py-1.5 before:text-sm before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:text-center lg:before:content-none"
                    >
                      {user.roles.includes('admin') ? (
                        <span className="text-xs font-bold text-accent-coral">ADMIN</span>
                      ) : (
                        <span className="text-xs text-text-muted lg:hidden">—</span>
                      )}
                    </td>
                    <td
                      data-label="Joined"
                      className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs text-text-muted before:text-sm before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:before:content-none"
                    >
                      {new Date(user.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td
                      data-label="Actions"
                      className="flex items-center justify-between gap-2 px-2 py-1.5 before:text-sm before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:text-right lg:before:content-none"
                    >
                      <span className="flex gap-2 lg:space-x-2">
                        <button
                          onClick={() => handleToggleAdmin(user.id, user.roles.includes('admin'))}
                          className="text-xs px-2 py-1 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                        >
                          {user.roles.includes('admin') ? 'Revoke' : 'Grant'} Admin
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="text-xs px-2 py-1 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors"
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

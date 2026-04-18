import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';

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
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const result = await api.get<User[]>('/admin/users');
      setUsers(Array.isArray(result) ? result : []);
    } catch (err: any) {
      toast(err.message || 'Failed to load users', 'error');
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
    } catch (err: any) {
      toast(err.message || 'Failed to update user', 'error');
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
    } catch (err: any) {
      toast(err.message || 'Failed to delete user', 'error');
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading users...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">Users ({filteredUsers.length})</h2>
      </div>

      <input
        type="text"
        placeholder="Search by username or email..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
      />

      {filteredUsers.length === 0 ? (
        <p className="text-text-muted text-center py-8">No users found</p>
      ) : (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-glass-border bg-bg-primary/20">
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Username</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Email</th>
                  <th className="px-4 py-3 text-center text-text-muted font-medium">Verified</th>
                  <th className="px-4 py-3 text-center text-text-muted font-medium">Admin</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Joined</th>
                  <th className="px-4 py-3 text-right text-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-glass-border">
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-bg-primary/20 transition-colors">
                    <td className="px-4 py-3 text-text-primary font-medium">{user.username}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs">{user.email}</td>
                    <td className="px-4 py-3 text-center">
                      {user.isVerified ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-accent-green" title="Verified" />
                      ) : (
                        <span className="inline-block w-2 h-2 rounded-full bg-text-muted" title="Not verified" />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {user.roles.includes('admin') && <span className="text-xs font-bold text-accent-coral">ADMIN</span>}
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {new Date(user.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
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

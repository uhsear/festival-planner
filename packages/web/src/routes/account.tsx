import React, { useState, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api, getApiBase } from '@festie/shared/services/api';
import { useToast } from '../lib/toastContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Avatar from '../components/ui/Avatar';
import { Camera, Trash2, User, Lock, Download, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AccountPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const uploadAvatar = useAuthStore((s) => s.uploadAvatar);
  const removeAvatar = useAuthStore((s) => s.removeAvatar);
  const changePassword = useAuthStore((s) => s.changePassword);
  const logout = useAuthStore((s) => s.logout);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Username
  const [username, setUsername] = useState(user?.name || '');
  const [savingUsername, setSavingUsername] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Delete
  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Avatar
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);

  // GDPR
  const [exporting, setExporting] = useState(false);

  if (!user) {
    navigate({ to: '/login' });
    return null;
  }

  // --- Avatar ---
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingAvatar(true);
    try {
      await uploadAvatar(file);
      toast('Avatar updated', 'success');
    } catch {
      toast("Couldn't upload avatar. Try again.", 'error');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAvatarRemove = async () => {
    setRemovingAvatar(true);
    try {
      await removeAvatar();
      toast('Avatar removed', 'success');
    } catch {
      toast("Couldn't remove avatar. Try again.", 'error');
    } finally {
      setRemovingAvatar(false);
    }
  };

  // --- Username ---
  const handleUsernameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setSavingUsername(true);
    try {
      const updated = await api.put<{ name: string }>('/account/username', {
        username: username.trim(),
      });
      setUser({ ...user, name: updated.name ?? username.trim() });
      toast('Username updated', 'success');
    } catch {
      toast("Couldn't change username. Try again.", 'error');
    } finally {
      setSavingUsername(false);
    }
  };

  // --- Password ---
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    if (newPassword.length < 8) {
      toast('New password must be at least 8 characters', 'warning');
      return;
    }

    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast('Password changed', 'success');
    } catch {
      toast("Couldn't change password. Try again.", 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  // --- GDPR export ---
  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch(`${getApiBase()}/account/export`, {
        method: 'GET',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `festie-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded', 'success');
    } catch {
      toast("Couldn't export data. Try again.", 'error');
    } finally {
      setExporting(false);
    }
  };

  // --- Delete account ---
  const handleDelete = async () => {
    if (!deletePassword) return;

    setDeleting(true);
    try {
      await api.delete<void>('/account/', {
        body: { password: deletePassword },
      });
      await logout();
      toast('Account deleted', 'info');
      navigate({ to: '/login' });
    } catch {
      toast("Couldn't delete account. Try again.", 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        <h1 className="text-2xl font-display font-bold text-text-primary">
          Account Settings
        </h1>

        {/* Avatar section */}
        <section className="p-4 rounded-lg bg-bg-card border border-border space-y-4">
          <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
            <Camera className="w-4 h-4" />
            Avatar
          </h2>

          <div className="flex items-center gap-4">
            <Avatar name={user.name || 'User'} image={user.avatar} size="lg" />

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                isLoading={uploadingAvatar}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[44px] min-w-[44px]"
              >
                Upload
              </Button>

              {user.avatar && (
                <Button
                  variant="ghost"
                  size="sm"
                  isLoading={removingAvatar}
                  onClick={handleAvatarRemove}
                  className="min-h-[44px] min-w-[44px]"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleAvatarUpload}
          />
        </section>

        {/* Username section */}
        <section className="p-4 rounded-lg bg-bg-card border border-border space-y-4">
          <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
            <User className="w-4 h-4" />
            Username
          </h2>

          <form onSubmit={handleUsernameChange} className="flex gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Display name"
              className="flex-1"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={savingUsername}
              disabled={!username.trim() || username === user.name}
              className="min-h-[44px] min-w-[44px]"
            >
              Save
            </Button>
          </form>
        </section>

        {/* Password section */}
        <section className="p-4 rounded-lg bg-bg-card border border-border space-y-4">
          <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Change Password
          </h2>

          <form onSubmit={handlePasswordChange} className="space-y-3">
            <Input
              label="Current password"
              type="password"
              isPassword
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
            />
            <Input
              label="New password"
              type="password"
              isPassword
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min. 8 characters)"
            />
            <Button
              type="submit"
              variant="primary"
              fullWidth
              isLoading={savingPassword}
              disabled={!currentPassword || !newPassword}
              className="min-h-[44px]"
            >
              Update Password
            </Button>
          </form>
        </section>

        {/* GDPR export section */}
        <section className="p-4 rounded-lg bg-bg-card border border-border space-y-4">
          <h2 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export Data
          </h2>

          <p className="text-sm text-text-muted">
            Download all your data in JSON format.
          </p>

          <Button
            variant="outline"
            fullWidth
            isLoading={exporting}
            onClick={handleExport}
            className="min-h-[44px]"
          >
            Download My Data
          </Button>
        </section>

        {/* Delete account section */}
        <section
          className={cn(
            'p-4 rounded-lg border space-y-4',
            'bg-accent-coral/5 border-accent-coral/30',
          )}
        >
          <h2 className="text-sm font-semibold text-accent-coral flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Delete Account
          </h2>

          <p className="text-sm text-text-muted">
            This will permanently delete your account and all associated data. This action cannot be undone.
          </p>

          {!showDeleteConfirm ? (
            <Button
              variant="danger"
              fullWidth
              onClick={() => setShowDeleteConfirm(true)}
              className="min-h-[44px]"
            >
              Delete My Account
            </Button>
          ) : (
            <div className="space-y-3">
              <Input
                label="Enter your password to confirm"
                type="password"
                isPassword
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Password"
              />

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeletePassword('');
                  }}
                  className="flex-1 min-h-[44px]"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  isLoading={deleting}
                  disabled={!deletePassword}
                  className="flex-1 min-h-[44px]"
                >
                  Confirm Delete
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

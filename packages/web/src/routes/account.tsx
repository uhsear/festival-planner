import React, { useState, useRef } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { api, getApiBase } from '@festie/shared/services/api';
import { useToast } from '../lib/toastContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Avatar from '../components/ui/Avatar';
import { Camera, Trash2, User, Lock, Download, Shield, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import AccountNotifications from '../components/account/AccountNotifications';
import AccountDangerZone from '../components/account/AccountDangerZone';

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

  return (
    <div className="bg-bg-primary pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Profile identity card */}
        <section className="p-4 rounded-lg bg-bg-card border border-border flex items-center gap-4">
          <Avatar name={user.name || 'User'} image={user.avatar} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-lg font-semibold text-text-primary truncate">
              {user.name || user.username || 'User'}
            </div>
            {user.email && (
              <div className="text-sm text-text-secondary truncate">{user.email}</div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 rounded-full bg-accent-aqua/15 text-accent-aqua font-medium">
                Account
              </span>
              {user.isAdmin && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent-amber/15 text-accent-amber font-medium">
                  Admin
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Admin + Logout quick actions */}
        <div className="flex gap-3">
          {user.isAdmin && (
            <Link
              to="/admin"
              className="flex-1 flex items-center justify-center gap-2 p-3 rounded-lg bg-accent-amber/10 border border-accent-amber/30 hover:bg-accent-amber/15 transition-colors text-sm font-semibold text-accent-amber min-h-[44px]"
            >
              <Shield className="w-4 h-4" />
              Admin Panel
            </Link>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                await logout();
              } catch {}
              navigate({ to: '/login' });
            }}
            className={cn(
              'flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors text-sm font-semibold min-h-[44px]',
              'bg-accent-coral/10 border-accent-coral/30 hover:bg-accent-coral/15 text-accent-coral',
              user.isAdmin ? 'flex-1' : 'w-full',
            )}
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>

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
            aria-label="Upload new avatar"
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
              autoComplete="username"
              maxLength={40}
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
              autoComplete="current-password"
            />
            <Input
              label="New password"
              type="password"
              isPassword
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min. 8 characters)"
              autoComplete="new-password"
              aria-describedby="pw-hint"
            />
            {newPassword.length > 0 && newPassword.length < 8 && (
              <p id="pw-hint" className="text-xs text-accent-coral">
                {8 - newPassword.length} more character{8 - newPassword.length === 1 ? '' : 's'} needed
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              isLoading={savingPassword}
              disabled={!currentPassword || !newPassword || newPassword.length < 8}
              className="min-h-[44px]"
            >
              Update Password
            </Button>
          </form>
        </section>

        <AccountNotifications />

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

        <AccountDangerZone />
      </div>
    </div>
  );
}

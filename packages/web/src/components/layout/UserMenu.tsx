import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore, useFestivalStore } from '@festie/shared';
import { getAvatarColor, getInitials } from '@festie/shared/utils';
import { useNavigate } from '@tanstack/react-router';
import { useToast } from '../../lib/toastContext';

interface UserMenuProps {
  user: {
    id: string;
    username: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    avatar?: string;
    avatarUrl?: string;
    isAdmin?: boolean;
  };
}

export default function UserMenu({ user }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const logout = useAuthStore((state) => state.logout);
  const uploadAvatar = useAuthStore((state) => state.uploadAvatar);
  const removeAvatar = useAuthStore((state) => state.removeAvatar);
  const changePassword = useAuthStore((state) => state.changePassword);
  const isLoading = useAuthStore((state) => state.isLoading);

  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const currentProfile = useFestivalStore((state) => state.currentProfile);

  // Compute pick/note stats from the current profile
  const summary = (() => {
    if (!currentProfile) return { total: 0, must: 0, want: 0, notes: 0 };
    const picks = currentProfile.picks || {};
    const notes = currentProfile.notes || {};
    let must = 0;
    let want = 0;
    for (const priority of Object.values(picks)) {
      if (priority === 'must') must++;
      else if (priority === 'want-to-see') want++;
    }
    return {
      total: Object.keys(picks).length,
      must,
      want,
      notes: Object.keys(notes).length,
    };
  })();

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab' && menuRef.current) {
        const focusable = menuRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen && menuRef.current) {
      const first = menuRef.current.querySelector<HTMLElement>('button, [href], input');
      first?.focus();
    }
    if (!isOpen) triggerRef.current?.focus();
  }, [isOpen]);

  const handleLogout = async () => {
    close();
    try {
      await logout();
    } catch (e) {
      console.error('Logout failed:', e);
    }
    // Always navigate — logout store action also clears state on error
    await navigate({ to: '/login' });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadAvatar(file);
    }
    // Reset the input so the same file can be re-selected
    e.target.value = '';
  };

  const handleRemoveAvatar = async () => {
    await removeAvatar();
  };

  const avatarName = user.username || user.name || '';

  return (
    <>
      {/* Trigger — profile badge in the header */}
      <button
        ref={triggerRef}
        className="profile-badge"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-label="Open user menu"
        data-testid="profile-badge"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={avatarName}
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              backgroundColor: getAvatarColor(avatarName),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            {getInitials(avatarName)}
          </div>
        )}
      </button>

      {/* Overlay + menu (matches legacy showUserMenu DOM) */}
      {isOpen && (
        <div
          className="user-menu-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="user-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label="User menu">
            {/* ── Profile card ───────────────────────────────── */}
            <div className="user-menu-profile-card" data-testid="user-menu-profile">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={avatarName}
                  width={52}
                  height={52}
                  loading="lazy"
                  decoding="async"
                  style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    backgroundColor: getAvatarColor(avatarName),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  {getInitials(avatarName)}
                </div>
              )}
              <div className="user-menu-copy">
                <div className="user-menu-name">{user.username}</div>
                <div className="user-menu-subline">Account identity across every festival</div>
                <div className="user-menu-badges">
                  <span className="identity-badge">Account</span>
                  {user.isAdmin && (
                    <span className="identity-badge identity-badge-admin">Admin</span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Festival Profile section ───────────────────── */}
            {currentFestival && (
              <section className="user-menu-section" data-testid="festival-profile-section">
                <div className="user-menu-section-title">Festival Profile</div>
                <div className="user-menu-section-copy">
                  {currentProfile
                    ? `Specific to ${currentFestival.name}. Picks, notes, and crew coordination live here.`
                    : `You have not joined ${currentFestival.name} yet. Join when you are ready to save picks and coordinate with the crew.`}
                </div>
                <div className="user-menu-status">
                  {currentProfile ? (
                    <>
                      <span className="identity-badge identity-badge-self">Joined</span>
                      <span className="identity-badge">Notes stay private</span>
                    </>
                  ) : (
                    <span className="identity-badge">Not joined</span>
                  )}
                </div>
                {currentProfile && (
                  <div className="user-menu-stats">
                    {([
                      [summary.total, 'Total picks'],
                      [summary.must, 'Must see'],
                      [summary.want, 'Want to see'],
                      [summary.notes, 'Notes'],
                    ] as const).map(([value, label]) => (
                      <div className="user-menu-stat" key={label}>
                        <strong>{value}</strong>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* ── Account section ────────────────────────────── */}
            <section className="user-menu-section" data-testid="account-section">
              <div className="user-menu-section-title">Account</div>

              {/* Photo row */}
              <div className="account-setting-row">
                <div className="account-setting-label">
                  <span className="account-setting-key">Photo</span>
                  <span className="account-setting-value">JPG, PNG, GIF, or WebP up to 5MB</span>
                </div>
                <div className="account-setting-actions">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    style={{ display: 'none' }}
                    data-testid="avatar-file-input"
                    onChange={handleFileChange}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={isLoading}
                    data-testid="avatar-upload-button"
                    onClick={() => {
                      if (!isLoading) fileInputRef.current?.click();
                    }}
                  >
                    {isLoading ? 'Uploading...' : 'Upload'}
                  </button>
                  {user.avatarUrl && (
                    <button
                      className="btn btn-ghost btn-sm btn-muted"
                      type="button"
                      disabled={isLoading}
                      data-testid="avatar-remove-button"
                      onClick={handleRemoveAvatar}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Email row */}
              <div className="account-setting-row">
                <div className="account-setting-label">
                  <span className="account-setting-key">Email</span>
                  {user.email ? (
                    <span className="account-setting-value">
                      {user.email}
                      {user.emailVerified ? (
                        <span className="account-verified-badge">Verified</span>
                      ) : (
                        <span className="account-unverified-badge">Unverified</span>
                      )}
                    </span>
                  ) : (
                    <span className="account-setting-value account-setting-empty">Not set</span>
                  )}
                </div>
                <div className="account-setting-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      close();
                      // No /auth/change-email endpoint exists yet — stub
                      // until the backend route lands so we don't ship a
                      // broken button.
                      toast('Email change coming soon', 'info');
                    }}
                  >
                    {user.email ? 'Change' : 'Add'}
                  </button>
                </div>
              </div>

              {/* Password row */}
              <div className="account-setting-row">
                <div className="account-setting-label">
                  <span className="account-setting-key">Password</span>
                  <span className="account-setting-value">{'\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}</span>
                </div>
                <div className="account-setting-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      close();
                      setShowChangePassword(true);
                    }}
                  >
                    Change
                  </button>
                </div>
              </div>

              {/* Bottom actions */}
              <div className="user-menu-actions">
                {user.isAdmin && (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      close();
                      navigate({ to: '/admin' });
                    }}
                  >
                    Admin Panel
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onSubmit={async (currentPassword, newPassword) => {
            try {
              await changePassword({ currentPassword, newPassword });
              toast('Password changed', 'success');
              setShowChangePassword(false);
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Couldn't change password.";
              toast(msg, 'error');
            }
          }}
        />
      )}
    </>
  );
}

// ── Change Password modal ─────────────────────────────────────────────────
// Inline sub-component so the UserMenu stays a single-file unit. Submits
// to /auth/change-password via authStore.changePassword. The email-change
// counterpart is intentionally a toast stub (no backend route yet).

interface ChangePasswordModalProps {
  onClose: () => void;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
}

function ChangePasswordModal({ onClose, onSubmit }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(currentPassword, newPassword);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="user-menu-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="user-menu" role="dialog" aria-modal="true" aria-label="Change password">
        <section className="user-menu-section">
          <div className="user-menu-section-title">Change Password</div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="account-setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <label className="account-setting-key" htmlFor="cp-current">
                Current password
              </label>
              <input
                id="cp-current"
                type="password"
                autoComplete="current-password"
                className="input-base"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="account-setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <label className="account-setting-key" htmlFor="cp-new">
                New password
              </label>
              <input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                className="input-base"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="account-setting-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <label className="account-setting-key" htmlFor="cp-confirm">
                Confirm new password
              </label>
              <input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                className="input-base"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {error && (
              <div role="alert" className="account-setting-value" style={{ color: 'var(--color-accent-coral)' }}>
                {error}
              </div>
            )}
            <div className="user-menu-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={busy || !currentPassword || !newPassword || !confirmPassword}
              >
                {busy ? 'Saving...' : 'Update Password'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

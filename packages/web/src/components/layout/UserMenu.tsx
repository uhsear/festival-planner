import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore, useFestivalStore } from '@festie/shared';
import { useNavigate } from '@tanstack/react-router';

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

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 50%)`;
}

function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().substring(0, 2) || '?';
}

export default function UserMenu({ user }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const logout = useAuthStore((state) => state.logout);
  const uploadAvatar = useAuthStore((state) => state.uploadAvatar);
  const removeAvatar = useAuthStore((state) => state.removeAvatar);
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

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, close]);

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
        className="profile-badge"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Open user menu"
        data-testid="profile-badge"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={avatarName}
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
          <div className="user-menu">
            {/* ── Profile card ───────────────────────────────── */}
            <div className="user-menu-profile-card" data-testid="user-menu-profile">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={avatarName}
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
                      // TODO: wire up showChangeEmail modal
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
                      // TODO: wire up showChangePassword modal
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
    </>
  );
}

import React, { useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useToast } from '../../lib/toastContext';

interface UserMenuAccountSectionProps {
  user: {
    email?: string;
    emailVerified?: boolean;
    avatarUrl?: string;
    isAdmin?: boolean;
  };
  isLoading: boolean;
  onClose: () => void;
  onLogout: () => void;
  onChangePassword: () => void;
}

export default function UserMenuAccountSection({
  user,
  isLoading,
  onClose,
  onLogout,
  onChangePassword,
}: UserMenuAccountSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const uploadAvatar = useAuthStore((state) => state.uploadAvatar);
  const removeAvatar = useAuthStore((state) => state.removeAvatar);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadAvatar(file);
    }
    e.target.value = ''; // eslint-disable-line require-atomic-updates -- synchronous reset after await, not a real race
  };

  const handleRemoveAvatar = async () => {
    await removeAvatar();
  };

  return (
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
            className="hidden"
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
              onClose();
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
          <span className="account-setting-value">{'••••••••'}</span>
        </div>
        <div className="account-setting-actions">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => {
              onClose();
              onChangePassword();
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
              onClose();
              navigate({ to: '/admin' });
            }}
          >
            Admin Panel
          </button>
        )}
        <button
          className="btn btn-danger btn-sm"
          type="button"
          onClick={onLogout}
        >
          Logout
        </button>
      </div>
    </section>
  );
}

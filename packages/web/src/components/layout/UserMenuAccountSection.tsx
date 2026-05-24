import React, { useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';

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
    <section className="pt-3 mt-3 border-t border-border first-of-type:pt-0 first-of-type:mt-0 first-of-type:border-t-0" data-testid="account-section">
      <div className="text-[11px] font-bold tracking-[1.2px] uppercase text-text-secondary mb-1.5">Account</div>

      {/* Photo row */}
      <div className="flex items-center justify-between gap-[var(--space-5)] py-2.5 border-b border-[var(--overlay-3)]">
        <div className="flex flex-col gap-[var(--space-1)] min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]">Photo</span>
          <span className="text-[13px] text-text-primary overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[var(--space-3)]">JPG, PNG, GIF, or WebP up to 5MB</span>
        </div>
        <div className="flex gap-[var(--space-3)] shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            data-testid="avatar-file-input"
            onChange={handleFileChange}
          />
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={isLoading}
            data-testid="avatar-upload-button"
            onClick={() => {
              if (!isLoading) fileInputRef.current?.click();
            }}
          >
            {isLoading ? 'Uploading...' : 'Upload'}
          </Button>
          {user.avatarUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="opacity-65 hover:opacity-100"
              type="button"
              disabled={isLoading}
              data-testid="avatar-remove-button"
              onClick={handleRemoveAvatar}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* Email row */}
      <div className="flex items-center justify-between gap-[var(--space-5)] py-2.5 border-b border-[var(--overlay-3)]">
        <div className="flex flex-col gap-[var(--space-1)] min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]">Email</span>
          {user.email ? (
            <span className="text-[13px] text-text-primary overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[var(--space-3)]">
              {user.email}
              {user.emailVerified ? (
                <span className="inline-flex items-center text-[11px] font-semibold px-[7px] py-0.5 rounded-[var(--radius-md)] tracking-[.3px] whitespace-nowrap bg-[var(--status-verified-bg)] text-[var(--status-verified)]">Verified</span>
              ) : (
                <span className="inline-flex items-center text-[11px] font-semibold px-[7px] py-0.5 rounded-[var(--radius-md)] tracking-[.3px] whitespace-nowrap bg-[var(--status-unverified-bg)] text-[var(--status-unverified)]">Unverified</span>
              )}
            </span>
          ) : (
            <span className="text-[13px] text-text-muted italic overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[var(--space-3)]">Not set</span>
          )}
        </div>
        <div className="flex gap-[var(--space-3)] shrink-0">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              onClose();
              toast('Email change coming soon', 'info');
            }}
          >
            {user.email ? 'Change' : 'Add'}
          </Button>
        </div>
      </div>

      {/* Password row */}
      <div className="flex items-center justify-between gap-[var(--space-5)] py-2.5">
        <div className="flex flex-col gap-[var(--space-1)] min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-[.8px]">Password</span>
          <span className="text-[13px] text-text-primary overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[var(--space-3)]">{'••••••••'}</span>
        </div>
        <div className="flex gap-[var(--space-3)] shrink-0">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              onClose();
              onChangePassword();
            }}
          >
            Change
          </Button>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col gap-[var(--space-3)]">
        {user.isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              onClose();
              navigate({ to: '/admin' });
            }}
          >
            Admin Panel
          </Button>
        )}
        <Button
          variant="danger"
          size="sm"
          type="button"
          onClick={onLogout}
        >
          Logout
        </Button>
      </div>
    </section>
  );
}

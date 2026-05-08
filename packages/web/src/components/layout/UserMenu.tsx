import React, { useState, useCallback } from 'react';
import { useAuthStore } from '@festie/shared';
import { getAvatarColor, getInitials } from '@festie/shared/utils';
import { useNavigate } from '@tanstack/react-router';
import { useToast } from '../../lib/toastContext';
import ChangePasswordModal from './ChangePasswordModal';
import UserMenuPanel from './UserMenuPanel';
import UserMenuProfileCard from './UserMenuProfileCard';
import UserMenuAccountSection from './UserMenuAccountSection';

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
  const navigate = useNavigate();
  const { toast } = useToast();

  const logout = useAuthStore((state) => state.logout);
  const changePassword = useAuthStore((state) => state.changePassword);
  const isLoading = useAuthStore((state) => state.isLoading);

  const close = useCallback(() => setIsOpen(false), []);

  const handleLogout = async () => {
    close();
    try {
      await logout();
    } catch (e) {
      console.error('Logout failed:', e);
    }
    await navigate({ to: '/login' });
  };

  const handleChangePasswordSubmit = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    try {
      await changePassword({ currentPassword, newPassword });
      toast('Password changed', 'success');
      setShowChangePassword(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Couldn't change password.";
      toast(msg, 'error');
    }
  };

  const avatarName = user.username || user.name || '';

  return (
    <>
      {/* Trigger -- profile badge in the header */}
      <button
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
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ backgroundColor: getAvatarColor(avatarName) }}
          >
            {getInitials(avatarName)}
          </div>
        )}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <UserMenuPanel ariaLabel="User menu" onClose={close}>
          <UserMenuProfileCard user={user} />
          <UserMenuAccountSection
            user={user}
            isLoading={isLoading}
            onClose={close}
            onLogout={handleLogout}
            onChangePassword={() => setShowChangePassword(true)}
          />
        </UserMenuPanel>
      )}

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onSubmit={handleChangePasswordSubmit}
        />
      )}
    </>
  );
}

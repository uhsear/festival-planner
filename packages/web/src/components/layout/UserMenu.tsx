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
        className="profile-badge flex items-center gap-[var(--space-5)] px-3 py-2 bg-bg-card backdrop-blur-[8px] border border-border-light rounded-3xl text-[length:var(--font-size-13)] font-semibold cursor-pointer text-text-primary text-left min-h-11 transition-[border-color,box-shadow,background] duration-200 ease-out hover:border-[rgba(0,232,208,.35)] hover:shadow-[0_0_20px_var(--color-aqua-a12),0_4px_12px_var(--color-shade-7)] hover:bg-[var(--color-overlay-3)] max-md:py-[3px] max-md:px-1.5 max-md:pr-[3px] max-md:gap-[5px] max-md:shrink-0 max-sm:w-11 max-sm:h-11 max-sm:min-w-11 max-sm:p-[7px] max-sm:justify-center max-sm:gap-0"
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
            className="h-8 w-8 rounded-full object-cover max-sm:h-[30px] max-sm:w-[30px]"
          />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-[length:var(--font-size-13)] font-semibold text-white max-sm:h-[30px] max-sm:w-[30px] max-sm:text-xs"
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

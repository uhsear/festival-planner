import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '@festie/shared';
import { getAvatarColor, getInitials } from '@festie/shared/utils';
import { useNavigate } from '@tanstack/react-router';
import { useToast } from '../../lib/toastContext';
import ChangePasswordModal from './ChangePasswordModal';
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const logout = useAuthStore((state) => state.logout);
  const changePassword = useAuthStore((state) => state.changePassword);
  const isLoading = useAuthStore((state) => state.isLoading);

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
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
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
    await navigate({ to: '/login' });
  };

  const avatarName = user.username || user.name || '';

  return (
    <>
      {/* Trigger -- profile badge in the header */}
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

      {/* Overlay + menu */}
      {isOpen && (
        <div
          className="user-menu-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="user-menu" ref={menuRef} role="dialog" aria-modal="true" aria-label="User menu">
            <UserMenuProfileCard user={user} />
            <UserMenuAccountSection
              user={user}
              isLoading={isLoading}
              onClose={close}
              onLogout={handleLogout}
              onChangePassword={() => setShowChangePassword(true)}
            />
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

import React, { useRef } from 'react';
import { useKeyboardTrap } from '../../hooks/useKeyboardTrap';

interface UserMenuPanelProps {
  /** Label for the dialog (used by screen readers). */
  ariaLabel: string;
  /** Called when the user clicks the backdrop or presses Escape. */
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Overlay + dialog shell shared by the user-menu dropdown and
 * the change-password modal. Provides backdrop dismiss, ARIA
 * `dialog` role, and keyboard focus trapping.
 */
export default function UserMenuPanel({
  ariaLabel,
  onClose,
  children,
}: UserMenuPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useKeyboardTrap(panelRef, true, onClose);

  return (
    <div
      className="fixed inset-0 z-[200]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="user-menu-panel fixed top-[68px] right-[var(--space-9)] z-[201] w-[min(360px,calc(100vw-20px))] max-h-[min(calc(100vh-92px),760px)] overflow-y-auto rounded-DEFAULT border border-border-light bg-[rgba(14,14,26,.96)] p-[var(--space-7)] shadow-[0_18px_48px_rgba(0,0,0,.55),inset_0_1px_0_var(--color-overlay-2)] backdrop-saturate-[180%] backdrop-blur-[24px] pb-[calc(88px+env(safe-area-inset-bottom,0px))] overscroll-contain"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
}

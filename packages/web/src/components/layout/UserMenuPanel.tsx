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
      className="user-menu-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="user-menu"
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

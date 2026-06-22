import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import Button from './Button';
import IconButton from './IconButton';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}

/**
 * Styled confirmation modal built on Radix Dialog — mirrors PromptDialog
 * without the text input. Used for destructive actions (leave/delete crew)
 * so they get focus-trap, Escape handling, and consistent styling instead
 * of the unstyled native window.confirm.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  busy = false,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2
                     rounded-2xl bg-bg-card border border-border-light shadow-2xl p-5 space-y-4
                     data-[state=open]:animate-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-bold text-text-primary">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-sm text-text-secondary">{description}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} />
            </Dialog.Close>
          </div>

          <div className="flex gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" type="button" className="flex-1 min-h-11">
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant={destructive ? 'danger' : 'primary'}
              isLoading={busy}
              disabled={busy}
              onClick={() => onConfirm()}
              className="flex-1 min-h-11"
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

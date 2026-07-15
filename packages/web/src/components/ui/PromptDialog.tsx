import React, { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import Button from './Button';
import IconButton from './IconButton';
import { inputBase } from '../../lib/styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: 'text' | 'email' | 'number';
  onConfirm: (value: string) => void | Promise<void>;
  busy?: boolean;
  maxLength?: number;
  error?: string;
}

/**
 * Replacement for `window.prompt`. Built on Radix Dialog so it ports
 * focus-trap, Escape handling, aria-modal, portal mounting, and click-outside
 * dismissal for free. Keeps the "inline text input + confirm/cancel" pattern
 * that made prompts convenient without the blocking, un-styleable native sheet.
 */
export default function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  inputType = 'text',
  onConfirm,
  busy = false,
  maxLength = 200,
  error,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => { if (open) setValue(defaultValue); }, [open, defaultValue]);
  const uid = useId();
  const errorId = error ? `${uid}-error` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    await onConfirm(value.trim());
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in"
        />
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

          <form onSubmit={submit} className="space-y-3" {...(busy ? { 'aria-busy': true } : {})}>
            <input
              ref={inputRef}
              type={inputType}
              value={value}
              maxLength={maxLength}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={busy}
              aria-label={title}
              {...(error ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
              className={`${inputBase} min-h-11`}
            />
            {error && (
              <p
                id={errorId}
                role="alert"
                className="text-sm text-accent-coral animate-in fade-in slide-in-from-top-1 duration-200"
              >
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" type="button" className="flex-1 min-h-11">{cancelLabel}</Button>
              </Dialog.Close>
              <Button
                type="submit"
                variant="primary"
                isLoading={busy}
                disabled={!value.trim() || busy}
                className="flex-1 min-h-11"
              >
                {confirmLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

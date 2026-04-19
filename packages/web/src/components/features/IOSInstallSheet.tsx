import React from 'react';
import { Drawer } from 'vaul';
import { Share, Plus, X } from 'lucide-react';
import { useIOSInstall } from '../../hooks/useIOSInstall';
import IconButton from '../ui/IconButton';

/**
 * iOS "Add to Home Screen" sheet — now built on vaul so we get native-feel
 * drag-dismiss, focus trap, Escape, and scrim handling for free. The hook
 * still gates engagement (10s + 1 interaction) and 30-day cooldown.
 */
export default function IOSInstallSheet() {
  const { shouldShow, dismiss } = useIOSInstall();

  if (!shouldShow) return null;

  return (
    <Drawer.Root
      open
      onOpenChange={(open: boolean) => { if (!open) dismiss('scrim'); }}
      dismissible
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Drawer.Content
          className="fixed bottom-0 inset-x-0 z-50 rounded-t-2xl bg-bg-primary
                     border-t border-border-light shadow-2xl p-5 pb-8 space-y-4
                     max-h-[90vh] flex flex-col outline-none
                     lg:bottom-auto lg:inset-x-auto lg:top-1/2 lg:left-1/2
                     lg:-translate-x-1/2 lg:-translate-y-1/2
                     lg:w-[min(420px,calc(100vw-2rem))]
                     lg:rounded-2xl lg:border lg:border-border-light lg:border-t-0"
        >
          {/* Drag handle — visual affordance; vaul does the physics.
              Hidden on desktop where there's no drag affordance. */}
          <div className="mx-auto -mt-2 mb-2 h-1.5 w-12 rounded-full bg-text-muted/30 flex-shrink-0 lg:hidden" />

          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src="/icons/icon-192.png" width={48} height={48} alt=""
                className="rounded-xl flex-shrink-0" aria-hidden="true" />
              <div>
                <Drawer.Title className="text-base font-bold text-text-primary">
                  Add Festie to Home Screen
                </Drawer.Title>
                <Drawer.Description className="text-xs text-text-secondary mt-0.5">
                  Launch faster. Works offline. Full-screen.
                </Drawer.Description>
              </div>
            </div>
            <IconButton
              label="Close"
              icon={<X className="w-5 h-5" />}
              onClick={() => dismiss('close')}
              className="flex-shrink-0"
            />
          </div>

          <ol className="space-y-2 text-sm text-text-primary">
            <li className="flex items-center gap-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-bg-card border border-border text-xs font-bold text-text-secondary flex-shrink-0">1</span>
              <span className="flex-1">
                Tap the <Share className="inline w-4 h-4 mx-0.5 align-text-top text-accent-aqua" aria-label="Share" /> Share button
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-bg-card border border-border text-xs font-bold text-text-secondary flex-shrink-0">2</span>
              <span className="flex-1">Scroll to <strong>Add to Home Screen</strong></span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex items-center justify-center w-7 h-7 rounded-full bg-bg-card border border-border text-xs font-bold text-text-secondary flex-shrink-0">3</span>
              <span className="flex-1">
                Tap <Plus className="inline w-4 h-4 mx-0.5 align-text-top text-accent-aqua" aria-label="Add" /> <strong>Add</strong>
              </span>
            </li>
          </ol>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => dismiss('later')}
              className="flex-1 min-h-11 px-4 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-light text-sm font-medium"
            >
              Maybe later
            </button>
            <button
              type="button"
              onClick={() => dismiss('got-it')}
              className="flex-1 min-h-11 px-4 rounded-lg bg-accent-aqua text-bg-primary text-sm font-bold hover:bg-accent-aqua/90"
            >
              Got it
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

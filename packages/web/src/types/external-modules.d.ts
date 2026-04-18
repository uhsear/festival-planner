// Type shims for third-party packages that lack bundled .d.ts files in this
// checkout. These keep `tsc --noEmit` clean without needing @types/* deps
// we don't own. Drop these if/when the upstream ships types.

declare module 'vaul';
declare module '@radix-ui/react-dialog';
declare module 'html-to-image';

// Dev-only global store handles exposed in main.tsx under import.meta.env.DEV
// so Playwright + in-app smoke harnesses can seed zustand state. Tree-shaken
// out of prod builds.
interface Window {
  __fs?: unknown;
  __fms?: unknown;
  __festieQueue?: {
    queueMutation?: (args: unknown) => Promise<unknown>;
    processQueue?: () => Promise<unknown>;
  };
  __festieInstallPrompt?: BeforeInstallPromptEvent | null;
  // Safari/iOS-only standalone flag used by usePushNotifications.
  navigator: Navigator & { standalone?: boolean };
}

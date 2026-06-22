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

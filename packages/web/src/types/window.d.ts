declare global {
  interface BeforeInstallPromptEvent extends Event {
    readonly platforms: readonly string[];
    readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
    prompt(): Promise<void>;
  }

  interface Window {
    __FP_API_BASE?: string;
    __festieInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

export {};

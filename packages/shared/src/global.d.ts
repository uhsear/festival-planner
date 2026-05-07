interface Window {
  __festieQueue?: {
    queueMutation?: (args: unknown) => Promise<unknown>;
    processQueue?: () => Promise<unknown>;
  };
}

import { useEffect } from 'react';

/**
 * With vite-plugin-pwa configured as `registerType: 'autoUpdate'`, the
 * service worker uses skipWaiting + clientsClaim to activate immediately.
 * We keep a tiny component that listens for `controllerchange` and reloads
 * the page so the user lands on the new assets cleanly — no UI prompt.
 */
export default function UpdatePrompt() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleControllerChange = () => {
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Periodic update check so long-lived tabs pick up new SWs.
    const checkForUpdates = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.update();
      } catch (err) {
        console.error('SW update check failed:', err);
      }
    };
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 60000);

    return () => {
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}

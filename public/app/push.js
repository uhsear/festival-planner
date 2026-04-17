/**
 * Firebase Cloud Messaging — client-side push token registration.
 *
 * Loads the Firebase SDK from CDN (compat build, no bundler needed),
 * requests notification permission, gets a device token, and registers
 * it with the backend via POST /api/v1/notifications/token.
 *
 * IMPORTANT: Does NOT register a separate service worker. Uses the existing
 * sw.js registration (which includes Firebase messaging handlers) to avoid
 * scope conflicts that would break offline caching.
 */

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC1erbrclaoaYEnkcN3IPIwUNGBLyMa7y4',
  authDomain: 'festival-planner-a191b.firebaseapp.com',
  projectId: 'festival-planner-a191b',
  storageBucket: 'festival-planner-a191b.firebasestorage.app',
  messagingSenderId: '742304531990',
  appId: '1:742304531990:web:628d6d3b16ea4e834f1737',
};

const VAPID_KEY = 'BALNPV05RWu4564kGyCoIkL238AgM4u6_zMOJ7m7EwPHFcBp4HeXSVZ-iH-EgF4bqMpc1QPWGONavgw2xAXhKvs';

let _messaging = null;
let _currentToken = null;
let _initPromise = null;
let _onMessageRegistered = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initFirebaseMessaging() {
  await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  await loadScript('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  _messaging = firebase.messaging();
  return _messaging;
}

function getInitPromise() {
  if (!_initPromise) {
    _initPromise = initFirebaseMessaging().catch((err) => {
      // Clear cached promise so next call retries instead of failing forever
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

/**
 * Request push permission + register token with backend.
 * Safe to call multiple times — deduplicates and only registers when token changes.
 * @param {Function} apiCall - The api() function from api.js
 * @param {Function} [onMessage] - Optional callback for foreground messages
 * @returns {Promise<string|null>} The FCM token or null if denied/unavailable
 */
export async function registerPushToken(apiCall, onMessage) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return null;
  if (Notification.permission === 'denied') return null;

  try {
    const messaging = await getInitPromise();

    // Use the existing sw.js registration — do NOT register a separate SW
    // to avoid scope conflicts that would break offline caching
    const registration = await navigator.serviceWorker.ready;

    const token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return null;

    // Only re-register if token changed
    if (token !== _currentToken) {
      const platform = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios'
        : /Android/.test(navigator.userAgent) ? 'android' : 'web';

      await apiCall('/notifications/token', {
        method: 'POST',
        body: { token, platform },
      });
      _currentToken = token;
    }

    // Listen for foreground messages — register only once to prevent stacking
    if (onMessage && !_onMessageRegistered) {
      _onMessageRegistered = true;
      messaging.onMessage((payload) => {
        onMessage(payload);
      });
    }

    return token;
  } catch (err) {
    console.error('Push registration failed:', err);
    return null;
  }
}

/**
 * Unregister the current push token from the backend.
 * Call on logout.
 * @param {Function} apiCall - The api() function from api.js
 */
export async function unregisterPushToken(apiCall) {
  if (!_currentToken) return;
  try {
    await apiCall('/notifications/token', {
      method: 'DELETE',
      body: { token: _currentToken },
    });
  } catch (err) {
    console.error('Push unregister failed:', err);
  }
  _currentToken = null;
}

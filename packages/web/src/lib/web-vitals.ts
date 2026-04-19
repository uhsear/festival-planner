import { onCLS, onLCP, onINP, onFCP, onTTFB, type Metric } from 'web-vitals';

// Note: web-vitals v5 removed onFID (deprecated in favor of INP).
// We include INP + the remaining Core Web Vitals + TTFB.

const ENDPOINT = '/api/v1/metrics/web-vitals';
const QUEUE_KEY = 'fp:webvitals:queue';
const QUEUE_CAP = 50;

interface Payload {
  name: string;
  value: number;
  rating?: string;
  delta?: number;
  id?: string;
  url: string;
  navigationType?: string;
}

function readQueue(): Payload[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, QUEUE_CAP) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: Payload[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_CAP)));
  } catch {
    /* quota exceeded / private mode — drop silently */
  }
}

function enqueue(p: Payload): void {
  const q = readQueue();
  q.push(p);
  writeQueue(q);
}

function postOne(p: Payload): boolean {
  const body = JSON.stringify(p);
  if (navigator.sendBeacon) {
    try {
      return navigator.sendBeacon(ENDPOINT, body);
    } catch {
      return false;
    }
  }
  // Fallback fetch — treat as best-effort; success not guaranteed.
  fetch(ENDPOINT, {
    body,
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => {});
  return true;
}

function flushQueue(): void {
  const q = readQueue();
  if (q.length === 0) return;
  const remaining: Payload[] = [];
  for (const item of q) {
    const ok = postOne(item);
    if (!ok) remaining.push(item);
  }
  writeQueue(remaining);
}

function send(metric: Metric) {
  const payload: Payload = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    url: window.location.pathname,
    navigationType: metric.navigationType,
  };

  // Offline — queue and bail.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    enqueue(payload);
    return;
  }

  const ok = postOne(payload);
  if (!ok) enqueue(payload);
}

export function initWebVitals(): void {
  onCLS(send);
  onLCP(send);
  onINP(send);
  onFCP(send);
  onTTFB(send);

  // Flush on reconnect.
  window.addEventListener('online', flushQueue);

  // Flush on page-hide (last chance before unload).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushQueue();
  });

  // Attempt an initial drain if we booted with pending queued items.
  if (navigator.onLine !== false) flushQueue();
}

/**
 * Payment deep links for settle-up.
 *
 * Each builder takes a payee handle, an amount in INTEGER CENTS, and an optional
 * note, and returns both the native app deep link (`app`) and an https web
 * fallback (`web`). Callers should try `app` first (mobile) and fall back to
 * `web` (or use `web` directly on desktop). Returns `null` when no handle is
 * provided so callers can omit the button entirely.
 *
 * Amounts are passed as cents to stay consistent with the integer-cent ledger;
 * they are formatted to a 2-dp dollar string here. Handles are normalized
 * (leading @/$ stripped) and URL-encoded.
 */

export interface PaymentLinkInput {
  /** Payee handle (Venmo username, Cash App $cashtag, or PayPal.me name). */
  handle: string | null | undefined;
  /** Amount owed, in integer cents. */
  amountCents: number;
  /** Optional memo prefilled into the payment. */
  note?: string;
}

export interface PaymentLink {
  /** Native app deep link (e.g. venmo://…). */
  app: string;
  /** https web fallback. */
  web: string;
}

function dollars(amountCents: number): string {
  // Clamp negatives/NaN to 0 — a settle-up amount is always a positive debt.
  const cents = Number.isFinite(amountCents) ? Math.max(0, Math.round(amountCents)) : 0;
  return (cents / 100).toFixed(2);
}

function normalizeHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  const trimmed = handle
    .trim()
    .replace(/^[@$]+/, '')
    .trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Venmo. App: venmo://paycharge?txn=pay&recipients=<user>&amount=<amt>&note=<note>
 * Web fallback opens the Venmo profile (Venmo has no reliable prefilled web pay URL).
 */
export function venmoLink({ handle, amountCents, note }: PaymentLinkInput): PaymentLink | null {
  const user = normalizeHandle(handle);
  if (!user) return null;
  const amount = dollars(amountCents);
  const params = new URLSearchParams({ txn: 'pay', recipients: user, amount });
  if (note) params.set('note', note);
  return {
    app: `venmo://paycharge?${params.toString()}`,
    web: `https://venmo.com/${encodeURIComponent(user)}?txn=pay&amount=${amount}${
      note ? `&note=${encodeURIComponent(note)}` : ''
    }`,
  };
}

/**
 * Cash App. The cashtag drops a leading '$'. Cash App's web/app pay URL takes
 * the amount as a path segment: https://cash.app/$cashtag/<amount>.
 */
export function cashAppLink({ handle, amountCents }: PaymentLinkInput): PaymentLink | null {
  const tag = normalizeHandle(handle);
  if (!tag) return null;
  const amount = dollars(amountCents);
  const url = `https://cash.app/$${encodeURIComponent(tag)}/${amount}`;
  return { app: url, web: url };
}

/**
 * PayPal.me. App: paypal://… is unreliable, so both point at paypal.me, which
 * deep-links into the app when installed. Amount + currency are path/query.
 */
export function payPalLink({ handle, amountCents }: PaymentLinkInput): PaymentLink | null {
  const name = normalizeHandle(handle);
  if (!name) return null;
  const amount = dollars(amountCents);
  const url = `https://www.paypal.com/paypalme/${encodeURIComponent(name)}/${amount}`;
  return { app: url, web: url };
}

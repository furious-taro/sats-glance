// Formatting for the G2 display (pure). Widths are measured with
// @evenrealities/pretext, which replicates the firmware's LVGL font metrics.

import { getAdvW, getTextWidth, pxTruncate } from '@evenrealities/pretext';
import type { Fiat } from './types';

/** G2 canvas and the fixed LVGL line height (px). */
export const CANVAS_W = 576;
export const CANVAS_H = 288;
export const LINE_H = 27;

export function groupThousands(n: number): string {
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString();
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? '-' + out : out;
}

/** Sats with thousands separators; amounts of 0.1 BTC and up are shown in BTC. */
export function formatSats(sats: number): string {
  if (Math.abs(sats) >= 10_000_000) {
    const btc = (sats / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    return `${btc} BTC`;
  }
  return `${groupThousands(sats)} sats`;
}

const FIAT_PREFIX: Record<Fiat, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CAD: 'CA$',
  CHF: 'CHF ',
  AUD: 'A$',
  JPY: '¥',
};

/** Money without Intl (deterministic across WebViews). Small amounts keep cents. */
export function formatFiat(amount: number, fiat: Fiat, whole = false): string {
  const p = FIAT_PREFIX[fiat];
  if (whole || fiat === 'JPY' || Math.abs(amount) >= 1000) return `${p}${groupThousands(amount)}`;
  const cents = Math.round(Math.abs(amount) * 100);
  const units = Math.floor(cents / 100);
  const frac = (cents % 100).toString().padStart(2, '0');
  return `${amount < 0 ? '-' : ''}${p}${units}.${frac}`;
}

export function satsToFiat(sats: number, perBtc: number): number {
  return (sats / 1e8) * perBtc;
}

export function fiatToSats(amount: number, perBtc: number): number {
  return Math.round((amount / perBtc) * 1e8);
}

/** Compact age: "now", "42s", "7m", "3h", "2d". */
export function formatAge(ms: number): string {
  if (ms < 5_000) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Fee rate in sat/vB: one decimal below 10 (sub-sat fees exist), integer above. */
export function formatFeeRate(r: number): string {
  if (r < 10) return (Math.round(r * 10) / 10).toString();
  return Math.round(r).toString();
}

export function formatClock(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function shortAddr(addr: string): string {
  return addr.length <= 14 ? addr : `${addr.slice(0, 7)}…${addr.slice(-4)}`;
}

// ---------- pixel layout helpers ----------

export function textWidth(s: string): number {
  return getTextWidth(s);
}

/** Truncate to a pixel budget (appends "..." when cut). */
export function fit(s: string, maxPx: number): string {
  return pxTruncate(s, maxPx);
}

const SPACE_W = Math.max(1, getTextWidth(' '));

/** Pad with spaces so the string is at least `px` wide (the font is proportional). */
export function padRightPx(s: string, px: number): string {
  const missing = px - getTextWidth(s);
  return missing <= 0 ? s : s + ' '.repeat(Math.floor(missing / SPACE_W));
}

/**
 * Left text, spaces, right text: right part pushed toward `width`.
 * The left part is truncated if both do not fit.
 */
export function spread(left: string, right: string, width: number): string {
  // LVGL wraps a line that lands exactly on the edge; keep a small safety margin.
  width -= SPACE_W;
  const rw = getTextWidth(right);
  const l = fit(left, Math.max(0, width - rw - SPACE_W));
  const gap = width - getTextWidth(l) - rw;
  const spaces = Math.max(1, Math.floor(gap / SPACE_W));
  return l + ' '.repeat(spaces) + right;
}

/** True when every non-space glyph of `s` exists in the firmware font. */
export function glyphsSupported(s: string): boolean {
  for (const ch of s) {
    if (ch === '\n' || ch === ' ') continue;
    if (getAdvW(ch.codePointAt(0) as number) <= 0) return false;
  }
  return true;
}

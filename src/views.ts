// Builds the text for the three glasses containers from app state (pure).
// Every line is fitted to the container's pixel width, and the body never
// exceeds its line budget, so the firmware never needs to scroll it.

import { fiatToSats, fit, formatAge, formatClock, formatFeeRate, formatFiat, formatSats, groupThousands, padRightPx, satsToFiat, shortAddr, spread } from './format';
import { BODY, FOOTER, HEADER, innerWidth, maxLines } from './layout';
import { sortedPayments, type Payment, type PaymentsState } from './state/payments';
import { PAGES, type ChainInfo, type Config, type Fees, type GlassesView, type PageId, type Price } from './types';

export interface ViewModel {
  config: Config;
  payments: PaymentsState;
  fees: Fees | null;
  price: Price | null;
  chain: ChainInfo | null;
  page: PageId;
  demo: boolean;
  /** False after the last network refresh failed. */
  online: boolean;
  /** Overrides the header title, e.g. "★ NEW +25,000 sats". */
  banner: string | null;
  /** Overrides the footer hint, e.g. "Acknowledged". */
  flash: string | null;
  now: number;
}

/** vbytes of a typical 1-input, 2-output P2WPKH payment, used for the "send cost" line. */
export const TYPICAL_TX_VB = 141;

const TITLES: Record<PageId, string> = { payments: 'PAYMENTS', fees: 'FEES', price: 'PRICE' };

function networkTag(m: ViewModel): string {
  if (m.demo) return 'DEMO';
  return m.config.network === 'mainnet' ? 'BTC' : m.config.network.toUpperCase();
}

export function buildHeader(m: ViewModel): string {
  const dots = PAGES.map((p) => (p === m.page ? '●' : '○')).join('');
  const left = m.banner ?? `${dots}  ${TITLES[m.page]}`;
  const right = `${networkTag(m)} · ${m.online ? formatClock(new Date(m.now)) : 'OFFLINE'}`;
  return spread(left, right, innerWidth(HEADER));
}

export function buildFooter(m: ViewModel): string {
  if (m.flash) return fit(m.flash, innerWidth(FOOTER));
  const hint =
    m.page === 'payments'
      ? 'Tap: ack ★  ·  Hold: refresh  ·  Swipe: pages'
      : 'Swipe: pages  ·  Hold: refresh  ·  Tap×2: exit';
  return fit(hint, innerWidth(FOOTER));
}

function statusText(p: Payment, settleConfs: number): string {
  switch (p.status) {
    case 'mempool':
      return `in mempool · 0/${settleConfs} conf${p.rbf ? ' · RBF!' : ''}`;
    case 'confirming':
      return `${p.confs}/${settleConfs} conf`;
    case 'settled':
      return `settled · ${p.confs} conf`;
    case 'dropped':
      return 'DROPPED/replaced · not paid';
  }
}

function fiatOf(sats: number, m: ViewModel): string {
  return m.price ? formatFiat(satsToFiat(sats, m.price.perBtc), m.price.fiat) : '';
}

function paymentsBody(m: ViewModel): string[] {
  const w = innerWidth(BODY);
  const list = sortedPayments(m.payments);
  if (!m.demo && m.config.addresses.length === 0) {
    return [
      'No address to watch yet.',
      'On your phone, open Sats Glance and',
      'paste a public (watch-only) address.',
      'No keys, no sign-up, read-only.',
      '',
      '▶ Tap now to run the demo.',
    ];
  }
  if (list.length === 0) {
    const lines = [`Watching ${m.config.addresses.length} address${m.config.addresses.length === 1 ? '' : 'es'}:`];
    for (const a of m.config.addresses.slice(0, 3)) lines.push(`   ${padRightPx(a.label, 130)}${shortAddr(a.address)}`);
    if (m.config.addresses.length > 3) lines.push(`   +${m.config.addresses.length - 3} more`);
    lines.push('Waiting for incoming payments...');
    return lines;
  }
  const lines: string[] = [];
  const shown = list.slice(0, 3);
  for (const p of shown) {
    const mark = p.acked ? '○' : '★';
    const amount = p.status === 'dropped' ? `${mark} ${formatSats(p.sats)}` : `${mark} +${formatSats(p.sats)}`;
    lines.push(spread(amount, fiatOf(p.sats, m), w));
    lines.push(`     ${p.label} · ${statusText(p, m.config.settleConfs)} · ${formatAge(m.now - p.firstSeen)}`);
  }
  const unacked = list.filter((p) => !p.acked).length;
  const more = list.length - shown.length;
  if (more > 0 || unacked > 0) {
    const parts: string[] = [];
    if (unacked > 0) parts.push(`${unacked} new`);
    if (more > 0) parts.push(`${more} older`);
    lines.push(parts.join(' · '));
  }
  return lines;
}

function feesBody(m: ViewModel): string[] {
  if (!m.fees) return ['Loading fee rates...'];
  const f = m.fees;
  const row = (name: string, rate: number, extra = '') => `${padRightPx(name, 120)}${padRightPx(`${formatFeeRate(rate)} sat/vB`, 130)}${extra}`;
  const lines = [row('Fastest', f.fastest, '~next block'), row('30 min', f.halfHour), row('1 hour', f.hour), row('Economy', f.economy)];
  if (m.price && m.config.network === 'mainnet') {
    lines.push(`Send now ≈ ${formatFiat(satsToFiat(f.fastest * TYPICAL_TX_VB, m.price.perBtc), m.price.fiat)} (${TYPICAL_TX_VB} vB tx)`);
  }
  const c = m.chain;
  if (c && c.tipHeight > 0) {
    const ago = c.lastBlockTime ? ` · mined ${formatAge(Math.max(0, m.now - c.lastBlockTime))} ago` : '';
    lines.push(`Block ${groupThousands(c.tipHeight)}${ago}`);
    if (c.avgBlockMs) lines.push(`Avg block time ${(c.avgBlockMs / 60000).toFixed(1)} min`);
  }
  return lines;
}

function ladder(fiat: Price['fiat']): number[] {
  return fiat === 'JPY' ? [100, 1000, 10000] : [1, 10, 100];
}

function priceBody(m: ViewModel): string[] {
  if (!m.price) return ['Loading price...'];
  const p = m.price;
  const lines = [`1 BTC = ${formatFiat(p.perBtc, p.fiat)}`, `1,000 sats = ${formatFiat(satsToFiat(1000, p.perBtc), p.fiat)}`];
  for (const amt of ladder(p.fiat)) lines.push(`${formatFiat(amt, p.fiat, true)} = ${formatSats(fiatToSats(amt, p.perBtc))}`);
  const age = formatAge(Math.max(0, m.now - p.time));
  lines.push(`${age === 'now' ? 'Quote just now' : `Quote ${age} old`} · mempool.space`);
  if (m.config.network !== 'mainnet' && !m.demo) lines.push('(mainnet price; test coins are worthless)');
  return lines;
}

export function buildBody(m: ViewModel): string {
  const raw = m.page === 'payments' ? paymentsBody(m) : m.page === 'fees' ? feesBody(m) : priceBody(m);
  const w = innerWidth(BODY);
  return raw
    .slice(0, maxLines(BODY))
    .map((l) => fit(l, w))
    .join('\n');
}

export function buildView(m: ViewModel): GlassesView {
  return { header: buildHeader(m), body: buildBody(m), footer: buildFooter(m) };
}

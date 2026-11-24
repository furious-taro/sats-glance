// Payment state machine (pure).
//
//   (unseen) --seen in mempool--> MEMPOOL --mined--> CONFIRMING --N confs--> SETTLED
//                                    |                    ^  (reorg: back to MEMPOOL)
//                                    +--missing from 2 consecutive snapshots--> DROPPED
//
// A tx seen already mined is created directly in CONFIRMING/SETTLED.

import { confirmations, type Observation } from '../mempool/parse';

export type PaymentStatus = 'mempool' | 'confirming' | 'settled' | 'dropped';

export interface Payment {
  txid: string;
  address: string;
  label: string;
  sats: number;
  status: PaymentStatus;
  confs: number;
  blockHeight: number | null;
  rbf: boolean;
  acked: boolean;
  /** Unix ms when this app first saw the tx. */
  firstSeen: number;
  /** Consecutive snapshots of its address that did not include this unconfirmed tx. */
  missing: number;
}

export interface PaymentsState {
  tipHeight: number;
  payments: Record<string, Payment>;
  /** Addresses that have had at least one full snapshot (history baseline taken). */
  baselined: string[];
}

export type Change =
  | { kind: 'new'; payment: Payment }
  | { kind: 'confirmed'; payment: Payment }
  | { kind: 'settled'; payment: Payment }
  | { kind: 'dropped'; payment: Payment };

export type PaymentEvent =
  /** A full snapshot of one address' recent incoming txs. */
  | { type: 'snapshot'; address: string; observations: Observation[]; now: number }
  | { type: 'tip'; height: number }
  /** Acknowledge one payment (txid) or, without txid, the newest unacknowledged one. */
  | { type: 'ack'; txid?: string }
  | { type: 'ackAll' }
  /** Forget everything about addresses no longer watched. */
  | { type: 'retain'; addresses: string[] };

export const MAX_PAYMENTS = 20;
const DROP_AFTER_MISSING = 2;

export function initialPayments(): PaymentsState {
  return { tipHeight: 0, payments: {}, baselined: [] };
}

export function statusFor(confs: number, settleConfs: number): PaymentStatus {
  if (confs <= 0) return 'mempool';
  return confs >= settleConfs ? 'settled' : 'confirming';
}

/** Newest first. */
export function sortedPayments(s: PaymentsState): Payment[] {
  return Object.values(s.payments).sort((a, b) => b.firstSeen - a.firstSeen || a.txid.localeCompare(b.txid));
}

export function newestUnacked(s: PaymentsState): Payment | undefined {
  return sortedPayments(s).find((p) => !p.acked);
}

function withStatus(p: Payment, tip: number, settleConfs: number): { next: Payment; change?: Change } {
  if (p.status === 'dropped') return { next: p };
  const confs = confirmations(p.blockHeight, tip);
  const status = statusFor(confs, settleConfs);
  const next = { ...p, confs, status };
  if (p.status === 'mempool' && status !== 'mempool') return { next, change: { kind: status === 'settled' ? 'settled' : 'confirmed', payment: next } };
  if (p.status === 'confirming' && status === 'settled') return { next, change: { kind: 'settled', payment: next } };
  return { next };
}

function prune(payments: Record<string, Payment>): Record<string, Payment> {
  const list = Object.values(payments).sort((a, b) => b.firstSeen - a.firstSeen);
  if (list.length <= MAX_PAYMENTS) return payments;
  // Keep every unacked payment; drop the oldest acked ones first.
  const keep = new Set<string>();
  for (const p of list) if (!p.acked) keep.add(p.txid);
  for (const p of list) if (keep.size < MAX_PAYMENTS) keep.add(p.txid);
  const out: Record<string, Payment> = {};
  for (const id of keep) out[id] = payments[id];
  return out;
}

export function reducePayments(
  s: PaymentsState,
  e: PaymentEvent,
  settleConfs: number,
): { state: PaymentsState; changes: Change[] } {
  const changes: Change[] = [];
  switch (e.type) {
    case 'tip': {
      if (e.height <= s.tipHeight) return { state: s, changes };
      const payments: Record<string, Payment> = {};
      for (const p of Object.values(s.payments)) {
        const r = withStatus(p, e.height, settleConfs);
        payments[p.txid] = r.next;
        if (r.change) changes.push(r.change);
      }
      return { state: { ...s, tipHeight: e.height, payments }, changes };
    }
    case 'snapshot': {
      const isBaseline = !s.baselined.includes(e.address);
      const payments = { ...s.payments };
      const seen = new Set<string>();
      for (const [i, o] of e.observations.entries()) {
        seen.add(o.txid);
        const prev = payments[o.txid];
        if (!prev) {
          const confs = confirmations(o.blockHeight, s.tipHeight);
          const p: Payment = {
            txid: o.txid,
            address: o.address,
            label: o.label,
            sats: o.sats,
            blockHeight: o.blockHeight,
            confs,
            status: statusFor(confs, settleConfs),
            rbf: o.rbf,
            // History that was already confirmed before we started watching is not "news".
            acked: isBaseline && o.blockHeight !== null,
            // Keep API order (newest first) stable for txs discovered in the same snapshot.
            firstSeen: e.now - i,
            missing: 0,
          };
          payments[o.txid] = p;
          if (!p.acked) changes.push({ kind: 'new', payment: p });
          continue;
        }
        const updated: Payment = { ...prev, blockHeight: o.blockHeight, rbf: o.rbf, label: o.label, missing: 0 };
        if (prev.status === 'dropped') updated.status = 'mempool'; // reappeared (e.g. rebroadcast)
        const r = withStatus(updated, s.tipHeight, settleConfs);
        payments[o.txid] = r.next;
        if (r.change) changes.push(r.change);
      }
      // Unconfirmed payments of this address that vanished: replaced (RBF) or evicted.
      for (const p of Object.values(payments)) {
        if (p.address !== e.address || seen.has(p.txid) || p.status !== 'mempool') continue;
        const missing = p.missing + 1;
        if (missing >= DROP_AFTER_MISSING) {
          const dropped: Payment = { ...p, missing, status: 'dropped' };
          payments[p.txid] = dropped;
          changes.push({ kind: 'dropped', payment: dropped });
        } else {
          payments[p.txid] = { ...p, missing };
        }
      }
      const baselined = isBaseline ? [...s.baselined, e.address] : s.baselined;
      return { state: { ...s, payments: prune(payments), baselined }, changes };
    }
    case 'ack': {
      const target = e.txid ? s.payments[e.txid] : newestUnacked(s);
      if (!target || target.acked) return { state: s, changes };
      return { state: { ...s, payments: { ...s.payments, [target.txid]: { ...target, acked: true } } }, changes };
    }
    case 'ackAll': {
      const payments: Record<string, Payment> = {};
      for (const p of Object.values(s.payments)) payments[p.txid] = p.acked ? p : { ...p, acked: true };
      return { state: { ...s, payments }, changes };
    }
    case 'retain': {
      const keep = new Set(e.addresses);
      const payments: Record<string, Payment> = {};
      for (const p of Object.values(s.payments)) if (keep.has(p.address)) payments[p.txid] = p;
      return { state: { ...s, payments, baselined: s.baselined.filter((a) => keep.has(a)) }, changes };
    }
  }
}

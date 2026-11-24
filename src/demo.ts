// Demo mode: a scripted, clearly labelled ("DEMO") payment sequence that runs
// through the real state machine, so the video does not depend on luck.
// Fee and price pages keep showing live public data during the demo.

import type { Observation } from './mempool/parse';

export const DEMO_ADDRESS = 'demo-address-not-real';

export interface DemoStep {
  /** ms after demo start */
  at: number;
  /** Simulated chain tip (relative to the starting tip). */
  tipOffset: number;
  /** Payments visible at this step; blockOffset null = in mempool. */
  txs: { txid: string; sats: number; label: string; blockOffset: number | null; rbf: boolean }[];
}

const A = 'd'.repeat(63) + '1';
const B = 'd'.repeat(63) + '2';
const C = 'd'.repeat(63) + '3';

export const DEMO_SCRIPT: DemoStep[] = [
  { at: 0, tipOffset: 0, txs: [] },
  { at: 4_000, tipOffset: 0, txs: [{ txid: A, sats: 25_000, label: 'Coffee', blockOffset: null, rbf: false }] },
  { at: 14_000, tipOffset: 1, txs: [{ txid: A, sats: 25_000, label: 'Coffee', blockOffset: 1, rbf: false }] },
  {
    at: 20_000,
    tipOffset: 1,
    txs: [
      { txid: A, sats: 25_000, label: 'Coffee', blockOffset: 1, rbf: false },
      { txid: B, sats: 4_100, label: 'Tip jar', blockOffset: null, rbf: true },
    ],
  },
  {
    at: 26_000,
    tipOffset: 2,
    txs: [
      { txid: A, sats: 25_000, label: 'Coffee', blockOffset: 1, rbf: false },
      { txid: B, sats: 4_100, label: 'Tip jar', blockOffset: null, rbf: true },
      { txid: C, sats: 120_000, label: 'Stall', blockOffset: null, rbf: false },
    ],
  },
  {
    at: 32_000,
    tipOffset: 3,
    txs: [
      { txid: A, sats: 25_000, label: 'Coffee', blockOffset: 1, rbf: false },
      { txid: C, sats: 120_000, label: 'Stall', blockOffset: 3, rbf: false },
      // B vanished: it was replaced (RBF) -> shown as DROPPED after two snapshots.
    ],
  },
  {
    at: 38_000,
    tipOffset: 3,
    txs: [
      { txid: A, sats: 25_000, label: 'Coffee', blockOffset: 1, rbf: false },
      { txid: C, sats: 120_000, label: 'Stall', blockOffset: 3, rbf: false },
    ],
  },
  {
    at: 44_000,
    tipOffset: 4,
    txs: [
      { txid: A, sats: 25_000, label: 'Coffee', blockOffset: 1, rbf: false },
      { txid: C, sats: 120_000, label: 'Stall', blockOffset: 3, rbf: false },
    ],
  },
];

export const DEMO_DURATION_MS = DEMO_SCRIPT[DEMO_SCRIPT.length - 1].at;

/** Observations and tip for one step, given the real tip at demo start. */
export function demoSnapshot(step: DemoStep, baseTip: number): { tip: number; observations: Observation[] } {
  return {
    tip: baseTip + step.tipOffset,
    observations: step.txs.map((t) => ({
      txid: t.txid,
      address: DEMO_ADDRESS,
      label: t.label,
      sats: t.sats,
      blockHeight: t.blockOffset === null ? null : baseTip + t.blockOffset,
      rbf: t.rbf,
    })),
  };
}

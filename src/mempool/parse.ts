// Pure parsers for the public mempool.space (Esplora-compatible) REST API.
// Every parser validates shape and throws ParseError on garbage, so a bad
// response never turns into a wrong number on the glasses.

import type { ChainInfo, Fees, Fiat, Price } from '../types';

export class ParseError extends Error {}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new ParseError(`bad ${what}`);
  return v;
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ParseError(`bad ${what}`);
  return v as Record<string, unknown>;
}

/** GET /api/v1/fees/recommended */
export function parseFees(json: unknown): Fees {
  const o = obj(json, 'fees');
  return {
    fastest: num(o.fastestFee, 'fastestFee'),
    halfHour: num(o.halfHourFee, 'halfHourFee'),
    hour: num(o.hourFee, 'hourFee'),
    economy: num(o.economyFee, 'economyFee'),
    minimum: num(o.minimumFee, 'minimumFee'),
  };
}

/** GET /api/v1/prices  ({ time: unix seconds, USD: n, EUR: n, ... }) */
export function parsePrice(json: unknown, fiat: Fiat): Price {
  const o = obj(json, 'prices');
  const perBtc = num(o[fiat], fiat);
  if (perBtc === 0) throw new ParseError(`no ${fiat} price`);
  return { fiat, perBtc, time: num(o.time, 'time') * 1000 };
}

/** GET /api/blocks/tip/height (plain text) */
export function parseTipHeight(text: string): number {
  const t = text.trim();
  if (!/^\d+$/.test(t)) throw new ParseError('bad tip height');
  return Number(t);
}

/** GET /api/v1/blocks  -> [{ height, timestamp (unix s) }, ...] newest first */
export function parseLatestBlock(json: unknown): { height: number; time: number } {
  if (!Array.isArray(json) || json.length === 0) throw new ParseError('bad blocks');
  const b = obj(json[0], 'block');
  return { height: num(b.height, 'height'), time: num(b.timestamp, 'timestamp') * 1000 };
}

/** GET /api/v1/difficulty-adjustment -> timeAvg (ms) */
export function parseAvgBlockMs(json: unknown): number {
  const o = obj(json, 'difficulty');
  return num(o.timeAvg, 'timeAvg');
}

export function chainInfo(tipHeight: number, lastBlockTime: number | null, avgBlockMs: number | null): ChainInfo {
  return { tipHeight, lastBlockTime, avgBlockMs };
}

// ---------- transactions ----------

export interface EsploraVin {
  txid: string;
  vout: number;
  sequence: number;
  is_coinbase?: boolean;
  prevout: { scriptpubkey_address?: string; value: number } | null;
}
export interface EsploraVout {
  scriptpubkey_address?: string;
  value: number;
}
export interface EsploraTx {
  txid: string;
  vin: EsploraVin[];
  vout: EsploraVout[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

/** GET /api/address/:addr/txs -> EsploraTx[] (mempool first, then confirmed). */
export function parseTxList(json: unknown): EsploraTx[] {
  if (!Array.isArray(json)) throw new ParseError('bad tx list');
  return json.map((t) => {
    const o = obj(t, 'tx');
    if (typeof o.txid !== 'string' || !/^[0-9a-f]{64}$/.test(o.txid)) throw new ParseError('bad txid');
    if (!Array.isArray(o.vin) || !Array.isArray(o.vout)) throw new ParseError('bad tx io');
    const status = obj(o.status, 'status');
    if (typeof status.confirmed !== 'boolean') throw new ParseError('bad status');
    return o as unknown as EsploraTx;
  });
}

/** Net sats received by `address` in `tx` (outputs to it minus inputs spent from it). */
export function netForAddress(tx: EsploraTx, address: string): number {
  let net = 0;
  for (const o of tx.vout) if (o.scriptpubkey_address === address) net += o.value;
  for (const i of tx.vin) if (i.prevout?.scriptpubkey_address === address) net -= i.prevout.value;
  return net;
}

/** BIP-125: any input with nSequence < 0xfffffffe signals replaceability. */
export function signalsRbf(tx: EsploraTx): boolean {
  return tx.vin.some((i) => !i.is_coinbase && i.sequence < 0xfffffffe);
}

export interface Observation {
  txid: string;
  address: string;
  label: string;
  sats: number;
  /** Block height if confirmed, else null (in mempool). */
  blockHeight: number | null;
  rbf: boolean;
}

/** Turns an address' tx list into incoming-payment observations (outgoing txs are ignored). */
export function observationsFor(txs: EsploraTx[], address: string, label: string): Observation[] {
  const out: Observation[] = [];
  for (const tx of txs) {
    const sats = netForAddress(tx, address);
    if (sats <= 0) continue;
    out.push({
      txid: tx.txid,
      address,
      label,
      sats,
      blockHeight: tx.status.confirmed && typeof tx.status.block_height === 'number' ? tx.status.block_height : null,
      rbf: !tx.status.confirmed && signalsRbf(tx),
    });
  }
  return out;
}

/** Confirmations of a tx mined at `blockHeight` given the current tip. */
export function confirmations(blockHeight: number | null, tipHeight: number): number {
  if (blockHeight === null) return 0;
  // Tip not known yet (or lagging behind the tx's block): it is mined, so at least 1.
  return Math.max(1, tipHeight - blockHeight + 1);
}

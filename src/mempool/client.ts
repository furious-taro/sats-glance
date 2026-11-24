// Read-only client for the public mempool.space API (REST + WebSocket).
// No API key, no account, nothing is ever posted except WebSocket subscriptions.

import type { Network } from '../types';
import {
  observationsFor,
  parseAvgBlockMs,
  parseFees,
  parseLatestBlock,
  parsePrice,
  parseTipHeight,
  parseTxList,
  type Observation,
} from './parse';
import type { ChainInfo, Fees, Fiat, Price } from '../types';

export const ORIGIN = 'https://mempool.space';

export function apiBase(network: Network): string {
  return network === 'mainnet' ? `${ORIGIN}/api` : `${ORIGIN}/${network}/api`;
}

export function wsUrl(network: Network): string {
  return network === 'mainnet' ? 'wss://mempool.space/api/v1/ws' : `wss://mempool.space/${network}/api/v1/ws`;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class MempoolClient {
  constructor(
    private network: Network,
    private fetchFn: FetchFn = (u, i) => fetch(u, i),
    private timeoutMs = 10_000,
  ) {}

  private async get(path: string, base = apiBase(this.network)): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(base + path, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async fees(): Promise<Fees> {
    return parseFees(await (await this.get('/v1/fees/recommended')).json());
  }

  /** Prices only exist for mainnet; test networks reuse the mainnet quote. */
  async price(fiat: Fiat): Promise<Price> {
    return parsePrice(await (await this.get('/v1/prices', apiBase('mainnet'))).json(), fiat);
  }

  async chain(): Promise<ChainInfo> {
    const [tip, blocks, diff] = await Promise.allSettled([
      this.get('/blocks/tip/height').then((r) => r.text()).then(parseTipHeight),
      this.get('/v1/blocks').then((r) => r.json()).then(parseLatestBlock),
      this.get('/v1/difficulty-adjustment').then((r) => r.json()).then(parseAvgBlockMs),
    ]);
    if (tip.status === 'rejected') throw tip.reason;
    const last = blocks.status === 'fulfilled' && blocks.value.height === tip.value ? blocks.value.time : null;
    return { tipHeight: tip.value, lastBlockTime: last, avgBlockMs: diff.status === 'fulfilled' ? diff.value : null };
  }

  /** Incoming payments to one address (latest mempool + recent confirmed txs). */
  async incoming(address: string, label: string): Promise<Observation[]> {
    return observationsFor(parseTxList(await (await this.get(`/address/${encodeURIComponent(address)}/txs`)).json()), address, label);
  }

  /**
   * Status of a tx that dropped out of the address listing: confirmed height,
   * null if still unconfirmed, or 'gone' if the node no longer knows it.
   */
  async txStatus(txid: string): Promise<{ blockHeight: number | null } | 'gone'> {
    try {
      const r = await this.get(`/tx/${txid}/status`);
      const s = (await r.json()) as { confirmed?: boolean; block_height?: number };
      return { blockHeight: s.confirmed && typeof s.block_height === 'number' ? s.block_height : null };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('HTTP 404')) return 'gone';
      throw e;
    }
  }
}

export interface LiveFeedHandlers {
  onBlock: (height: number) => void;
  /** Something changed for a tracked address: refetch it. */
  onAddressActivity: () => void;
  onStatus?: (connected: boolean) => void;
}

/**
 * WebSocket push from mempool.space: new blocks (instant confirmation updates)
 * and, best effort, address activity. REST polling stays the source of truth;
 * this only makes updates arrive sooner.
 */
export class LiveFeed {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private network: Network,
    private addresses: string[],
    private h: LiveFeedHandlers,
  ) {}

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.closed || typeof WebSocket === 'undefined') return;
    const ws = new WebSocket(wsUrl(this.network));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.h.onStatus?.(true);
      ws.send(JSON.stringify({ action: 'want', data: ['blocks'] }));
      if (this.addresses.length === 1) ws.send(JSON.stringify({ 'track-address': this.addresses[0] }));
      else if (this.addresses.length > 1) ws.send(JSON.stringify({ 'track-addresses': this.addresses }));
    };
    ws.onmessage = (m) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      const block = msg.block as { height?: unknown } | undefined;
      if (block && typeof block.height === 'number') this.h.onBlock(block.height);
      if ('address-transactions' in msg || 'block-transactions' in msg || 'multi-address-transactions' in msg) this.h.onAddressActivity();
    };
    ws.onclose = () => {
      this.h.onStatus?.(false);
      if (this.closed) return;
      const delay = Math.min(60_000, 2_000 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }
}

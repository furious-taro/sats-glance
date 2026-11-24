// App controller: owns state, timers and network; emits a ViewModel on every change.

import { deserializeConfig, serializeConfig } from './config';
import { DEMO_ADDRESS, DEMO_DURATION_MS, DEMO_SCRIPT, demoSnapshot } from './demo';
import { formatClock, formatFiat, formatSats, satsToFiat } from './format';
import { MENU, type Action } from './input';
import { LiveFeed, MempoolClient, type FetchFn } from './mempool/client';
import type { Observation } from './mempool/parse';
import { initialPayments, reducePayments, type Change, type PaymentEvent, type PaymentsState } from './state/payments';
import type { KV } from './storage';
import { PAGES, type ChainInfo, type Config, type Fees, type PageId, type Price } from './types';
import type { ViewModel } from './views';

export const POLL_ADDRESSES_MS = 15_000;
export const POLL_CHAIN_MS = 30_000;
export const POLL_PRICE_MS = 60_000;
const TICK_MS = 5_000;
const BANNER_MS = 8_000;
const FLASH_MS = 3_000;

const CONFIG_KEY = 'sg.config';
const paymentsKey = (c: Config) => `sg.payments.${c.network}`;

export class App {
  config: Config = deserializeConfig(null);
  private payments: PaymentsState = initialPayments();
  private demoPayments: PaymentsState | null = null;
  private demoTimers: ReturnType<typeof setTimeout>[] = [];
  private fees: Fees | null = null;
  private price: Price | null = null;
  private chain: ChainInfo | null = null;
  private page: PageId = 'payments';
  private online = true;
  private banner: { text: string; until: number } | null = null;
  private flash: { text: string; until: number } | null = null;
  private client: MempoolClient;
  private feed: LiveFeed | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private listeners: ((m: ViewModel) => void)[] = [];
  private refreshing: Promise<void> | null = null;

  constructor(
    private storage: KV,
    private fetchFn: FetchFn = (u, i) => fetch(u, i),
    private now: () => number = () => Date.now(),
  ) {
    this.client = new MempoolClient(this.config.network, fetchFn);
  }

  get demo(): boolean {
    return this.demoPayments !== null;
  }

  subscribe(fn: (m: ViewModel) => void): void {
    this.listeners.push(fn);
    fn(this.model());
  }

  model(): ViewModel {
    const now = this.now();
    if (this.banner && this.banner.until <= now) this.banner = null;
    if (this.flash && this.flash.until <= now) this.flash = null;
    return {
      config: this.config,
      payments: this.demoPayments ?? this.payments,
      fees: this.fees,
      price: this.price,
      chain: this.chain,
      page: this.page,
      demo: this.demo,
      online: this.online,
      banner: this.banner?.text ?? null,
      flash: this.flash?.text ?? null,
      now,
    };
  }

  private emit(): void {
    const m = this.model();
    for (const fn of this.listeners) fn(m);
  }

  async load(): Promise<void> {
    this.config = deserializeConfig(await this.storage.get(CONFIG_KEY));
    await this.loadPayments();
    this.client = new MempoolClient(this.config.network, this.fetchFn);
  }

  private async loadPayments(): Promise<void> {
    const raw = await this.storage.get(paymentsKey(this.config));
    let s = initialPayments();
    if (raw) {
      try {
        const o = JSON.parse(raw) as PaymentsState;
        if (o && typeof o === 'object' && o.payments && Array.isArray(o.baselined)) s = o;
      } catch {
        /* corrupt: start clean */
      }
    }
    this.payments = reducePayments(s, { type: 'retain', addresses: this.config.addresses.map((a) => a.address) }, this.config.settleConfs).state;
  }

  private savePayments(): void {
    void this.storage.set(paymentsKey(this.config), JSON.stringify(this.payments));
  }

  start(): void {
    this.stopTimers();
    this.timers.push(setInterval(() => void this.pollAddresses(), POLL_ADDRESSES_MS));
    this.timers.push(setInterval(() => void this.pollChain(), POLL_CHAIN_MS));
    this.timers.push(setInterval(() => void this.pollPrice(), POLL_PRICE_MS));
    this.timers.push(setInterval(() => this.emit(), TICK_MS));
    this.feed?.stop();
    this.feed = new LiveFeed(
      this.config.network,
      this.config.addresses.map((a) => a.address),
      {
        onBlock: (h) => {
          this.applyReal({ type: 'tip', height: h });
          void this.refresh();
        },
        onAddressActivity: () => void this.pollAddresses(),
      },
    );
    this.feed.start();
    void this.refresh();
  }

  stop(): void {
    this.stopTimers();
    this.feed?.stop();
    this.stopDemo(false);
  }

  private stopTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  async reconfigure(next: Config): Promise<void> {
    const networkChanged = next.network !== this.config.network;
    this.config = next;
    await this.storage.set(CONFIG_KEY, serializeConfig(next));
    if (networkChanged) {
      this.chain = null;
      this.fees = null;
      await this.loadPayments();
    } else {
      this.payments = reducePayments(this.payments, { type: 'retain', addresses: next.addresses.map((a) => a.address) }, next.settleConfs).state;
      this.savePayments();
    }
    this.client = new MempoolClient(next.network, this.fetchFn);
    this.setFlash('Settings updated');
    this.start();
  }

  // ---------- data ----------

  /** Full refresh: chain + fees + price + addresses. Concurrent calls share one run. */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        await this.pollChain();
        await Promise.all([this.pollPrice(), this.pollAddresses()]);
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  private async pollChain(): Promise<void> {
    try {
      const [chain, fees] = await Promise.all([this.client.chain(), this.client.fees()]);
      this.chain = chain;
      this.fees = fees;
      this.online = true;
      this.applyReal({ type: 'tip', height: chain.tipHeight });
    } catch (e) {
      console.warn('[sats-glance] chain/fees refresh failed', e);
      this.online = false;
    }
    this.emit();
  }

  private async pollPrice(): Promise<void> {
    try {
      this.price = await this.client.price(this.config.fiat);
    } catch (e) {
      console.warn('[sats-glance] price refresh failed', e);
    }
    this.emit();
  }

  private async pollAddresses(): Promise<void> {
    for (const { address, label } of this.config.addresses) {
      try {
        const obs = await this.client.incoming(address, label);
        const seen = new Set(obs.map((o) => o.txid));
        // Unconfirmed payments missing from the listing: confirmed off the list, or really gone?
        for (const p of Object.values(this.payments.payments)) {
          if (p.address !== address || p.status !== 'mempool' || seen.has(p.txid)) continue;
          const st = await this.client.txStatus(p.txid);
          if (st !== 'gone') obs.push({ txid: p.txid, address, label, sats: p.sats, blockHeight: st.blockHeight, rbf: p.rbf });
        }
        this.applyReal({ type: 'snapshot', address, observations: obs, now: this.now() });
      } catch (e) {
        console.warn('[sats-glance] address refresh failed', address, e);
      }
    }
  }

  private applyReal(e: PaymentEvent): void {
    const r = reducePayments(this.payments, e, this.config.settleConfs);
    if (r.state === this.payments) return;
    this.payments = r.state;
    this.savePayments();
    this.announce(r.changes);
    this.emit();
  }

  private announce(changes: Change[]): void {
    // Most important change wins the banner.
    const order: Change['kind'][] = ['new', 'dropped', 'settled', 'confirmed'];
    const c = [...changes].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
    if (!c) return;
    const amt = formatSats(c.payment.sats);
    const fiat = this.price ? ` ${formatFiat(satsToFiat(c.payment.sats, this.price.perBtc), this.price.fiat)}` : '';
    const text =
      c.kind === 'new'
        ? `★ NEW +${amt}${fiat}`
        : c.kind === 'confirmed'
          ? `1st confirmation: +${amt}`
          : c.kind === 'settled'
            ? `Settled: +${amt}`
            : `DROPPED: ${amt} not paid`;
    this.banner = { text, until: this.now() + BANNER_MS };
    if (c.kind === 'new' || c.kind === 'dropped') this.page = 'payments';
  }

  private setFlash(text: string): void {
    this.flash = { text, until: this.now() + FLASH_MS };
  }

  // ---------- demo ----------

  toggleDemo(): void {
    if (this.demo) this.stopDemo(true);
    else this.startDemo();
  }

  startDemo(): void {
    this.stopDemo(false);
    const baseTip = this.chain?.tipHeight || 900_000;
    this.demoPayments = initialPayments();
    this.page = 'payments';
    this.setFlash('Demo started: scripted payments');
    for (const step of DEMO_SCRIPT) {
      this.demoTimers.push(
        setTimeout(() => {
          if (!this.demoPayments) return;
          const snap = demoSnapshot(step, baseTip);
          this.applyDemo({ type: 'tip', height: snap.tip });
          this.applyDemo({ type: 'snapshot', address: DEMO_ADDRESS, observations: snap.observations as Observation[], now: this.now() });
        }, step.at),
      );
    }
    this.demoTimers.push(setTimeout(() => this.stopDemo(true), DEMO_DURATION_MS + 15_000));
    this.emit();
  }

  stopDemo(announce: boolean): void {
    for (const t of this.demoTimers) clearTimeout(t);
    this.demoTimers = [];
    if (!this.demoPayments) return;
    this.demoPayments = null;
    this.banner = null;
    if (announce) {
      this.setFlash('Demo ended: back to live data');
      this.emit();
    }
  }

  private applyDemo(e: PaymentEvent): void {
    if (!this.demoPayments) return;
    const r = reducePayments(this.demoPayments, e, this.config.settleConfs);
    this.demoPayments = r.state;
    this.announce(r.changes);
    this.emit();
  }

  // ---------- input ----------

  private ack(): void {
    if (this.demoPayments) {
      const before = this.demoPayments;
      this.demoPayments = reducePayments(before, { type: 'ack' }, this.config.settleConfs).state;
      this.setFlash(before === this.demoPayments ? 'Nothing new to acknowledge' : 'Acknowledged');
    } else {
      const before = this.payments;
      this.payments = reducePayments(before, { type: 'ack' }, this.config.settleConfs).state;
      if (before !== this.payments) this.savePayments();
      this.setFlash(before === this.payments ? 'Nothing new to acknowledge' : 'Acknowledged');
    }
    this.banner = null;
  }

  private ackAll(): void {
    if (this.demoPayments) this.demoPayments = reducePayments(this.demoPayments, { type: 'ackAll' }, this.config.settleConfs).state;
    else {
      this.payments = reducePayments(this.payments, { type: 'ackAll' }, this.config.settleConfs).state;
      this.savePayments();
    }
    this.banner = null;
    this.setFlash('All acknowledged');
  }

  private manualRefresh(): void {
    this.setFlash('Refreshing...');
    this.emit();
    void this.refresh().then(() => {
      this.setFlash(this.online ? `Updated ${formatClock(new Date(this.now()))}` : 'Offline: retrying automatically');
      this.emit();
    });
  }

  private goPage(p: PageId): void {
    this.page = p;
    this.banner = null;
  }

  /** Returns true when the app should exit (caller shows the system dialog). */
  handle(a: Action): boolean {
    switch (a.type) {
      case 'none':
        return false;
      case 'exit':
        return true;
      case 'nextPage':
        this.goPage(PAGES[(PAGES.indexOf(this.page) + 1) % PAGES.length]);
        break;
      case 'prevPage':
        this.goPage(PAGES[(PAGES.indexOf(this.page) + PAGES.length - 1) % PAGES.length]);
        break;
      case 'tap':
        if (this.page === 'payments' && !this.demo && this.config.addresses.length === 0) this.startDemo();
        else this.ack();
        break;
      case 'refresh':
        this.manualRefresh();
        return false;
      case 'menu':
        if (a.id === MENU.refresh) {
          this.manualRefresh();
          return false;
        }
        if (a.id === MENU.ackAll) this.ackAll();
        else if (a.id === MENU.toggleDemo) this.toggleDemo();
        else if (a.id === MENU.payments) this.goPage('payments');
        else if (a.id === MENU.fees) this.goPage('fees');
        else if (a.id === MENU.price) this.goPage('price');
        break;
    }
    this.emit();
    return false;
  }
}

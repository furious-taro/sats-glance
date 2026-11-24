export type Network = 'mainnet' | 'testnet4' | 'signet';

/** Currencies mempool.space publishes in /api/v1/prices. */
export const FIATS = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'] as const;
export type Fiat = (typeof FIATS)[number];

export interface WatchedAddress {
  address: string;
  label: string;
}

export interface Config {
  network: Network;
  fiat: Fiat;
  addresses: WatchedAddress[];
  /** Confirmations after which a payment counts as settled. */
  settleConfs: number;
}

export type PageId = 'payments' | 'fees' | 'price';
export const PAGES: readonly PageId[] = ['payments', 'fees', 'price'];

export interface Fees {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
}

export interface Price {
  fiat: Fiat;
  /** Fiat per 1 BTC. */
  perBtc: number;
  /** Unix ms of the quote. */
  time: number;
}

export interface ChainInfo {
  tipHeight: number;
  /** Unix ms of the most recent block. */
  lastBlockTime: number | null;
  /** Average block interval in ms over the current difficulty epoch. */
  avgBlockMs: number | null;
}

/** Text for the three glasses containers. */
export interface GlassesView {
  header: string;
  body: string;
  footer: string;
}

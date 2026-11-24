import type { EsploraTx, Observation } from '../src/mempool/parse';
import { DEFAULT_CONFIG } from '../src/config';
import { initialPayments } from '../src/state/payments';
import type { ViewModel } from '../src/views';

export const ADDR = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
export const OTHER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

export function txid(n: number): string {
  return n.toString(16).padStart(64, '0');
}

export function tx(opts: {
  id: number;
  to?: { address: string; value: number }[];
  from?: { address: string; value: number; sequence?: number }[];
  confirmedAt?: number;
}): EsploraTx {
  return {
    txid: txid(opts.id),
    vin: (opts.from ?? [{ address: OTHER, value: 1_000_000 }]).map((f, i) => ({
      txid: txid(1000 + i),
      vout: 0,
      sequence: f.sequence ?? 0xffffffff,
      prevout: { scriptpubkey_address: f.address, value: f.value },
    })),
    vout: (opts.to ?? []).map((t) => ({ scriptpubkey_address: t.address, value: t.value })),
    status: opts.confirmedAt ? { confirmed: true, block_height: opts.confirmedAt, block_time: 1 } : { confirmed: false },
  };
}

export function obs(id: number, sats: number, blockHeight: number | null, extra: Partial<Observation> = {}): Observation {
  return { txid: txid(id), address: ADDR, label: 'Stall', sats, blockHeight, rbf: false, ...extra };
}

export function model(over: Partial<ViewModel> = {}): ViewModel {
  return {
    config: { ...DEFAULT_CONFIG, addresses: [{ address: ADDR, label: 'Stall' }] },
    payments: initialPayments(),
    fees: { fastest: 12, halfHour: 8, hour: 5, economy: 2, minimum: 1 },
    price: { fiat: 'USD', perBtc: 59_784, time: 1_795_556_705_000 },
    chain: { tipHeight: 977_420, lastBlockTime: 1_795_556_400_000, avgBlockMs: 551_636 },
    page: 'payments',
    demo: false,
    online: true,
    banner: null,
    flash: null,
    now: 1_795_556_705_000,
    ...over,
  };
}

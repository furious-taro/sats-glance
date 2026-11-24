import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app';
import { MENU } from '../src/input';
import type { KV } from '../src/storage';
import { buildView } from '../src/views';
import { ADDR, OTHER, tx } from './helpers';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

function memoryKV(init: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    get: async (k) => data[k] ?? null,
    set: async (k, v) => {
      data[k] = v;
    },
  };
}

/** Fake mempool.space: routes by path; `addressTxs` can be swapped between polls. */
function fakeApi(state: { tip: number; addressTxs: unknown[] }) {
  const urls: string[] = [];
  const fn = async (url: string): Promise<Response> => {
    urls.push(url);
    const path = url.replace('https://mempool.space', '');
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path.endsWith('/blocks/tip/height')) return new Response(String(state.tip), { status: 200 });
    if (path.endsWith('/v1/blocks')) return json([{ height: state.tip, timestamp: 1_795_556_400 }]);
    if (path.endsWith('/v1/difficulty-adjustment')) return new Response(fixture('difficulty.json'), { status: 200 });
    if (path.endsWith('/v1/fees/recommended')) return json({ fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 2, minimumFee: 1 });
    if (path.endsWith('/v1/prices')) return json({ time: 1_795_556_705, USD: 60_000, EUR: 55_000, GBP: 45_000, CAD: 85_000, CHF: 50_000, AUD: 90_000, JPY: 9_500_000 });
    if (path.includes('/address/')) return json(state.addressTxs);
    if (path.includes('/tx/')) return new Response('Transaction not found', { status: 404 });
    return new Response('not found', { status: 404 });
  };
  return { fn, urls };
}

const config = JSON.stringify({ network: 'mainnet', fiat: 'USD', settleConfs: 3, addresses: [{ address: ADDR, label: 'Stall' }] });

afterEach(() => {
  vi.useRealTimers();
});

describe('App controller', () => {
  it('loads settings, refreshes from the API and shows a new payment with banner + fiat', async () => {
    const api = { tip: 977_420, addressTxs: [] as unknown[] };
    const fake = fakeApi(api);
    const kv = memoryKV({ 'sg.config': config });
    const app = new App(kv, fake.fn, () => 1_795_556_705_000);
    await app.load();
    await app.refresh();
    let v = buildView(app.model());
    expect(v.body).toMatch(/Waiting for incoming payments/);
    expect(fake.urls.every((u) => u.startsWith('https://mempool.space/api/'))).toBe(true); // read-only public API only

    api.addressTxs = [tx({ id: 7, to: [{ address: ADDR, value: 25_000 }, { address: OTHER, value: 1 }] })];
    app.handle({ type: 'nextPage' }); // user is on the fees page...
    await app.refresh();
    v = buildView(app.model());
    expect(app.model().page).toBe('payments'); // ...a new payment brings payments to front
    expect(v.header).toMatch(/★ NEW \+25,000 sats \$15\.00/);
    expect(v.body).toMatch(/in mempool · 0\/3 conf/);

    // Mined in the next block.
    api.tip += 1;
    api.addressTxs = [tx({ id: 7, to: [{ address: ADDR, value: 25_000 }], confirmedAt: api.tip })];
    await app.refresh();
    expect(buildView(app.model()).body).toMatch(/1\/3 conf/);

    // Tap acknowledges; acknowledgement is persisted.
    app.handle({ type: 'tap' });
    expect(buildView(app.model()).body).toMatch(/○ \+25,000 sats/);
    expect(buildView(app.model()).footer).toBe('Acknowledged');
    expect(JSON.parse(kv.data['sg.payments.mainnet']).payments).toMatchObject({ ['0'.repeat(63) + '7']: { acked: true } });
  });

  it('goes OFFLINE in the header when the API fails, without crashing', async () => {
    const app = new App(memoryKV({ 'sg.config': config }), async () => {
      throw new TypeError('network down');
    });
    await app.load();
    await app.refresh();
    expect(buildView(app.model()).header).toMatch(/OFFLINE$/);
  });

  it('double-tap asks the caller to exit; menu items navigate', async () => {
    const app = new App(memoryKV(), fakeApi({ tip: 1, addressTxs: [] }).fn);
    await app.load();
    expect(app.handle({ type: 'exit' })).toBe(true);
    app.handle({ type: 'menu', id: MENU.price });
    expect(app.model().page).toBe('price');
    app.handle({ type: 'prevPage' });
    expect(app.model().page).toBe('fees');
  });

  it('first tap with no address starts the labelled demo, which plays the scripted payments', async () => {
    vi.useFakeTimers();
    const app = new App(memoryKV(), fakeApi({ tip: 1, addressTxs: [] }).fn);
    await app.load();
    expect(buildView(app.model()).body).toMatch(/Tap now to run the demo/);
    app.handle({ type: 'tap' });
    expect(app.demo).toBe(true);
    expect(buildView(app.model()).header).toMatch(/DEMO/);
    await vi.advanceTimersByTimeAsync(4_100);
    expect(buildView(app.model()).body).toMatch(/Coffee · in mempool/);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(buildView(app.model()).body).toMatch(/Coffee · settled/);
    app.handle({ type: 'menu', id: MENU.toggleDemo });
    expect(app.demo).toBe(false);
    expect(buildView(app.model()).body).toMatch(/No address to watch yet/);
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_PAYMENTS, initialPayments, newestUnacked, reducePayments, sortedPayments, statusFor, type PaymentsState } from '../src/state/payments';
import { ADDR, obs, txid } from './helpers';

const S = 3;
const run = (s: PaymentsState, ...events: Parameters<typeof reducePayments>[1][]) => {
  const changes = [];
  for (const e of events) {
    const r = reducePayments(s, e, S);
    s = r.state;
    changes.push(...r.changes.map((c) => `${c.kind}:${c.payment.txid.slice(-2)}`));
  }
  return { s, changes };
};

describe('statusFor', () => {
  it('maps confirmations to statuses', () => {
    expect(statusFor(0, 3)).toBe('mempool');
    expect(statusFor(2, 3)).toBe('confirming');
    expect(statusFor(3, 3)).toBe('settled');
    expect(statusFor(1, 1)).toBe('settled');
  });
});

describe('payment state machine', () => {
  const base = () => run(initialPayments(), { type: 'tip', height: 100 }, { type: 'snapshot', address: ADDR, observations: [], now: 0 }).s;

  it('walks mempool -> 1 conf -> settled with one change per transition', () => {
    const { s, changes } = run(
      base(),
      { type: 'snapshot', address: ADDR, observations: [obs(1, 25_000, null)], now: 1000 },
      { type: 'snapshot', address: ADDR, observations: [obs(1, 25_000, 101)], now: 2000 }, // mined, tip still 100
      { type: 'tip', height: 101 },
      { type: 'tip', height: 102 },
      { type: 'tip', height: 103 },
      { type: 'tip', height: 104 },
    );
    expect(changes).toEqual(['new:01', 'confirmed:01', 'settled:01']);
    const p = s.payments[txid(1)];
    expect(p).toMatchObject({ status: 'settled', confs: 4, acked: false, sats: 25_000 });
  });

  it('treats already-confirmed history at first snapshot as acknowledged (no alarm on startup)', () => {
    const { s, changes } = run(initialPayments(), { type: 'tip', height: 200 }, {
      type: 'snapshot',
      address: ADDR,
      observations: [obs(1, 5000, null), obs(2, 7000, 150)],
      now: 10,
    });
    expect(changes).toEqual(['new:01']); // only the unconfirmed one is news
    expect(s.payments[txid(2)]).toMatchObject({ acked: true, status: 'settled' });
    expect(s.payments[txid(1)]).toMatchObject({ acked: false, status: 'mempool' });
  });

  it('marks an unconfirmed payment dropped only after two snapshots without it', () => {
    const s1 = run(base(), { type: 'snapshot', address: ADDR, observations: [obs(1, 4100, null, { rbf: true })], now: 1 }).s;
    const once = run(s1, { type: 'snapshot', address: ADDR, observations: [], now: 2 });
    expect(once.changes).toEqual([]);
    expect(once.s.payments[txid(1)].status).toBe('mempool');
    const twice = run(once.s, { type: 'snapshot', address: ADDR, observations: [], now: 3 });
    expect(twice.changes).toEqual(['dropped:01']);
    expect(twice.s.payments[txid(1)].status).toBe('dropped');
    // A dropped tx that reappears goes back to the mempool state.
    const back = run(twice.s, { type: 'snapshot', address: ADDR, observations: [obs(1, 4100, null)], now: 4 });
    expect(back.s.payments[txid(1)].status).toBe('mempool');
  });

  it('a reorg that un-mines a payment returns it to mempool', () => {
    const s1 = run(base(), { type: 'snapshot', address: ADDR, observations: [obs(1, 10, 100)], now: 1 }).s;
    const s2 = run(s1, { type: 'snapshot', address: ADDR, observations: [obs(1, 10, null)], now: 2 }).s;
    expect(s2.payments[txid(1)]).toMatchObject({ status: 'mempool', confs: 0 });
  });

  it('ignores stale tips', () => {
    const s = base();
    expect(reducePayments(s, { type: 'tip', height: 99 }, S).state).toBe(s);
  });

  it('acks the newest unacknowledged payment first, then the next', () => {
    let { s } = run(base(), { type: 'snapshot', address: ADDR, observations: [obs(2, 2, null), obs(1, 1, null)], now: 100 });
    expect(newestUnacked(s)?.txid).toBe(txid(2));
    s = run(s, { type: 'ack' }).s;
    expect(newestUnacked(s)?.txid).toBe(txid(1));
    s = run(s, { type: 'ack' }).s;
    expect(newestUnacked(s)).toBeUndefined();
    expect(reducePayments(s, { type: 'ack' }, S).state).toBe(s); // no-op keeps identity
  });

  it('ackAll acknowledges everything', () => {
    let { s } = run(base(), { type: 'snapshot', address: ADDR, observations: [obs(2, 2, null), obs(1, 1, null)], now: 100 });
    s = run(s, { type: 'ackAll' }).s;
    expect(Object.values(s.payments).every((p) => p.acked)).toBe(true);
  });

  it('sorts newest first and keeps API order inside one snapshot', () => {
    const { s } = run(
      base(),
      { type: 'snapshot', address: ADDR, observations: [obs(1, 1, null)], now: 100 },
      { type: 'snapshot', address: ADDR, observations: [obs(3, 3, null), obs(2, 2, null), obs(1, 1, null)], now: 200 },
    );
    expect(sortedPayments(s).map((p) => p.sats)).toEqual([3, 2, 1]);
  });

  it(`prunes to ${MAX_PAYMENTS} payments, never dropping unacknowledged ones`, () => {
    const many = Array.from({ length: 30 }, (_, i) => obs(i + 1, i + 1, 90)); // confirmed history -> acked at baseline
    let { s } = run(initialPayments(), { type: 'tip', height: 100 }, { type: 'snapshot', address: ADDR, observations: many, now: 1000 });
    expect(Object.keys(s.payments)).toHaveLength(MAX_PAYMENTS);
    s = run(s, { type: 'snapshot', address: ADDR, observations: [obs(99, 5, null), ...many], now: 5000 }).s;
    expect(s.payments[txid(99)]).toMatchObject({ acked: false });
    expect(Object.keys(s.payments)).toHaveLength(MAX_PAYMENTS);
  });

  it('retain forgets addresses that are no longer watched', () => {
    const { s } = run(base(), { type: 'snapshot', address: ADDR, observations: [obs(1, 1, null)], now: 1 }, { type: 'retain', addresses: [] });
    expect(s.payments).toEqual({});
    expect(s.baselined).toEqual([]);
  });
});

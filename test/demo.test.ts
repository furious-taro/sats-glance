import { describe, expect, it } from 'vitest';
import { DEMO_ADDRESS, DEMO_SCRIPT, demoSnapshot } from '../src/demo';
import { initialPayments, reducePayments, sortedPayments } from '../src/state/payments';

describe('demo script', () => {
  it('drives the real state machine through new -> confirmed -> settled and an RBF drop', () => {
    let s = initialPayments();
    const log: string[] = [];
    for (const step of DEMO_SCRIPT) {
      const snap = demoSnapshot(step, 900_000);
      for (const e of [
        { type: 'tip' as const, height: snap.tip },
        { type: 'snapshot' as const, address: DEMO_ADDRESS, observations: snap.observations, now: step.at },
      ]) {
        const r = reducePayments(s, e, 3);
        s = r.state;
        log.push(...r.changes.map((c) => `${c.kind} ${c.payment.label}`));
      }
    }
    expect(log).toEqual([
      'new Coffee',
      'confirmed Coffee',
      'new Tip jar',
      'new Stall',
      'settled Coffee',
      'confirmed Stall',
      'dropped Tip jar',
    ]);
    const final = Object.fromEntries(sortedPayments(s).map((p) => [p.label, p.status]));
    expect(final).toEqual({ Coffee: 'settled', 'Tip jar': 'dropped', Stall: 'confirming' });
  });

  it('is ordered in time', () => {
    for (let i = 1; i < DEMO_SCRIPT.length; i++) expect(DEMO_SCRIPT[i].at).toBeGreaterThan(DEMO_SCRIPT[i - 1].at);
  });
});

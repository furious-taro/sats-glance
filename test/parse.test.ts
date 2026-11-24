import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ParseError,
  confirmations,
  netForAddress,
  observationsFor,
  parseAvgBlockMs,
  parseFees,
  parseLatestBlock,
  parsePrice,
  parseTipHeight,
  parseTxList,
  signalsRbf,
} from '../src/mempool/parse';
import { ADDR, OTHER, tx } from './helpers';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

describe('real mempool.space responses (captured 2026-11-24)', () => {
  it('parses fees, prices, blocks, difficulty', () => {
    const fees = parseFees(fixture('fees.json'));
    expect(fees.fastest).toBeGreaterThanOrEqual(fees.economy);
    const p = parsePrice(fixture('prices.json'), 'EUR');
    expect(p.fiat).toBe('EUR');
    expect(p.perBtc).toBeGreaterThan(0);
    expect(p.time).toBeGreaterThan(1.7e12); // converted to ms
    const b = parseLatestBlock(fixture('blocks.json'));
    expect(b.height).toBeGreaterThan(900_000);
    expect(parseAvgBlockMs(fixture('difficulty.json'))).toBeGreaterThan(60_000);
  });

  it('parses an address tx list and computes incoming sats', () => {
    const { address, txs } = fixture('genesis-address-txs.json');
    const list = parseTxList(txs);
    expect(list).toHaveLength(3);
    const obs = observationsFor(list, address, 'Genesis');
    expect(obs.length).toBe(3);
    for (const [i, o] of obs.entries()) {
      const expected = list[i].vout.filter((v) => v.scriptpubkey_address === address).reduce((s, v) => s + v.value, 0);
      expect(o.sats).toBe(expected);
      expect(o.blockHeight).toBe(list[i].status.block_height);
    }
  });
});

describe('validation', () => {
  it('rejects malformed responses instead of showing wrong numbers', () => {
    expect(() => parseFees({ fastestFee: 'x' })).toThrow(ParseError);
    expect(() => parseFees([])).toThrow(ParseError);
    expect(() => parsePrice({ time: 1, USD: 0 }, 'USD')).toThrow(ParseError);
    expect(() => parsePrice({ time: 1 }, 'GBP')).toThrow(ParseError);
    expect(() => parseTipHeight('<html>')).toThrow(ParseError);
    expect(parseTipHeight(' 977420\n')).toBe(977420);
    expect(() => parseTxList({})).toThrow(ParseError);
    expect(() => parseTxList([{ txid: 'nothex', vin: [], vout: [], status: { confirmed: false } }])).toThrow(ParseError);
    expect(() => parseLatestBlock([])).toThrow(ParseError);
  });
});

describe('tx accounting', () => {
  it('nets outputs to the address against inputs it spent', () => {
    const t = tx({ id: 1, from: [{ address: ADDR, value: 50_000 }], to: [{ address: OTHER, value: 30_000 }, { address: ADDR, value: 19_000 }] });
    expect(netForAddress(t, ADDR)).toBe(-31_000);
    expect(observationsFor([t], ADDR, 'x')).toEqual([]); // outgoing is not a payment
  });

  it('sums several outputs to the same address', () => {
    const t = tx({ id: 2, to: [{ address: ADDR, value: 1000 }, { address: ADDR, value: 2500 }, { address: OTHER, value: 7 }] });
    expect(netForAddress(t, ADDR)).toBe(3500);
  });

  it('detects BIP-125 RBF signalling only while unconfirmed', () => {
    const rbf = tx({ id: 3, from: [{ address: OTHER, value: 9, sequence: 0xfffffffd }], to: [{ address: ADDR, value: 5 }] });
    const final = tx({ id: 4, from: [{ address: OTHER, value: 9, sequence: 0xfffffffe }], to: [{ address: ADDR, value: 5 }] });
    expect(signalsRbf(rbf)).toBe(true);
    expect(signalsRbf(final)).toBe(false);
    expect(observationsFor([rbf], ADDR, 'x')[0].rbf).toBe(true);
    const mined = { ...rbf, status: { confirmed: true, block_height: 10 } };
    expect(observationsFor([mined], ADDR, 'x')[0].rbf).toBe(false);
  });

  it('counts confirmations', () => {
    expect(confirmations(null, 100)).toBe(0);
    expect(confirmations(100, 100)).toBe(1);
    expect(confirmations(98, 100)).toBe(3);
    expect(confirmations(105, 0)).toBe(1); // tip unknown yet
  });
});

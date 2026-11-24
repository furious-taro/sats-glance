import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  MAX_ADDRESSES,
  checkSegwit,
  deserializeConfig,
  formatAddressLines,
  looksLikeSecret,
  parseAddressLines,
  serializeConfig,
  validateAddress,
} from '../src/config';

describe('address validation (BIP-173 / BIP-350 vectors)', () => {
  it.each([
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'mainnet'],
    ['bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3', 'mainnet'],
    ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'mainnet'],
    ['tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'testnet4'],
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', 'signet'],
    ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'mainnet'],
    ['3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'mainnet'],
    ['mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'testnet4'],
  ] as const)('accepts %s on %s', (addr, net) => {
    expect(validateAddress(addr, net)).toBeNull();
  });

  it('rejects a bad bech32 checksum (one-character typo)', () => {
    expect(validateAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', 'mainnet')).toMatch(/checksum/);
  });

  it('rejects taproot encoded with bech32 instead of bech32m', () => {
    expect(checkSegwit('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd', 'bc')).toMatch(/checksum/);
  });

  it('rejects mixed case and wrong network', () => {
    expect(validateAddress('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'mainnet')).toMatch(/mixed case/);
    expect(validateAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'mainnet')).toMatch(/bc1/);
    expect(validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'signet')).toMatch(/wrong network/);
    expect(validateAddress('hello', 'mainnet')).toMatch(/not a Bitcoin address/);
    expect(validateAddress('  ', 'mainnet')).toBe('empty');
  });
});

describe('secret detection', () => {
  it('flags WIF keys, xprvs and seed phrases', () => {
    expect(looksLikeSecret('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ')).toBe(true);
    expect(
      looksLikeSecret('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'),
    ).toBe(true);
    expect(looksLikeSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')).toBe(true);
  });
  it('does not flag addresses', () => {
    expect(looksLikeSecret('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false);
    expect(looksLikeSecret('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
  });
});

describe('parseAddressLines', () => {
  it('parses addresses with optional labels and dedupes', () => {
    const r = parseAddressLines(
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq Market stall\n\n  1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa\nbc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq dup',
      'mainnet',
    );
    expect(r.errors).toEqual([]);
    expect(r.addresses).toEqual([
      { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', label: 'Market stall' },
      { address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', label: 'Addr 2' },
    ]);
  });

  it('reports bad lines with line numbers and keeps good ones', () => {
    const r = parseAddressLines('nope\nbc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'mainnet');
    expect(r.addresses).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^Line 1:/);
  });

  it('refuses the whole input when a secret is pasted', () => {
    const r = parseAddressLines('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq\n5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ', 'mainnet');
    expect(r.secretRejected).toBe(true);
    expect(r.addresses).toEqual([]);
  });

  it(`caps at ${MAX_ADDRESSES} addresses`, () => {
    const many = [
      'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
      'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
      '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
    ].join('\n');
    const r = parseAddressLines(many, 'mainnet');
    expect(r.addresses).toHaveLength(MAX_ADDRESSES);
    expect(r.errors.join()).toMatch(/Only 5/);
  });

  it('round-trips through formatAddressLines', () => {
    const r = parseAddressLines('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa Genesis', 'mainnet');
    expect(parseAddressLines(formatAddressLines(r.addresses), 'mainnet').addresses).toEqual(r.addresses);
  });
});

describe('config persistence', () => {
  it('falls back to defaults on garbage', () => {
    expect(deserializeConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(deserializeConfig('{not json')).toEqual(DEFAULT_CONFIG);
    expect(deserializeConfig('{"network":"moon","fiat":"XYZ","settleConfs":99}')).toEqual(DEFAULT_CONFIG);
  });

  it('drops addresses that are invalid for the stored network', () => {
    const c = deserializeConfig(
      JSON.stringify({
        network: 'signet',
        fiat: 'EUR',
        settleConfs: 2,
        addresses: [
          { address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', label: 'main' },
          { address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', label: 'test' },
        ],
      }),
    );
    expect(c).toEqual({ network: 'signet', fiat: 'EUR', settleConfs: 2, addresses: [{ address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', label: 'test' }] });
    expect(deserializeConfig(serializeConfig(c))).toEqual(c);
  });
});

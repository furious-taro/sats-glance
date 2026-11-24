import { FIATS, type Config, type Fiat, type Network, type WatchedAddress } from './types';

export const DEFAULT_CONFIG: Config = {
  network: 'mainnet',
  fiat: 'USD',
  addresses: [],
  settleConfs: 3,
};

export const MAX_ADDRESSES = 5;
const NETWORKS: readonly Network[] = ['mainnet', 'testnet4', 'signet'];

// ---------- bech32 / bech32m (BIP-173 / BIP-350) ----------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

/** Returns null when `addr` is a valid segwit address for `hrp`, else a reason. */
export function checkSegwit(addr: string, hrp: string): string | null {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return 'mixed case';
  const a = addr.toLowerCase();
  const pos = a.lastIndexOf('1');
  if (pos < 1 || pos + 7 > a.length || a.length > 90) return 'bad length';
  if (a.slice(0, pos) !== hrp) return `expected ${hrp}1… prefix`;
  const data: number[] = [];
  for (const c of a.slice(pos + 1)) {
    const d = CHARSET.indexOf(c);
    if (d === -1) return `invalid character "${c}"`;
    data.push(d);
  }
  const constant = polymod([...hrpExpand(hrp), ...data]);
  const version = data[0];
  if (version > 16) return 'bad witness version';
  const expected = version === 0 ? BECH32_CONST : BECH32M_CONST;
  if (constant !== expected) return 'checksum mismatch (typo?)';
  const program = convertBits(data.slice(1, -6), 5, 8);
  if (!program || program.length < 2 || program.length > 40) return 'bad witness program';
  if (version === 0 && program.length !== 20 && program.length !== 32) return 'bad v0 program length';
  return null;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Validates a public Bitcoin address for the chosen network.
 * Segwit (bc1/tb1) addresses get a full bech32/bech32m checksum check;
 * legacy base58 addresses get a format and prefix check (the API rejects bad checksums).
 * Returns null if OK, otherwise a short human-readable reason.
 */
export function validateAddress(addr: string, network: Network): string | null {
  const a = addr.trim();
  if (!a) return 'empty';
  const hrp = network === 'mainnet' ? 'bc' : 'tb';
  if (/^(bc|tb|bcrt)1/i.test(a)) return checkSegwit(a, hrp);
  if (!BASE58.test(a) || a.length < 26 || a.length > 35) return 'not a Bitcoin address';
  const first = a[0];
  const ok = network === 'mainnet' ? first === '1' || first === '3' : first === 'm' || first === 'n' || first === '2';
  return ok ? null : `wrong network for ${network}`;
}

/** Looks like a private key / seed rather than an address: refuse to store it. */
export function looksLikeSecret(text: string): boolean {
  const t = text.trim();
  if (/^(xprv|tprv|yprv|zprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{20,}/.test(t)) return true; // extended private keys
  if (/^[5KLc9][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(t)) return true; // WIF private keys
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 12 && words.every((w) => /^[a-z]{3,8}$/.test(w))) return true; // mnemonic-like
  return false;
}

export interface ParsedAddresses {
  addresses: WatchedAddress[];
  errors: string[];
  /** True when the input looked like a private key or seed and was refused. */
  secretRejected: boolean;
}

/**
 * Parses the phone-side textarea: one address per line, optional label after a space.
 * Example line: `bc1q... Market stall`
 */
export function parseAddressLines(text: string, network: Network): ParsedAddresses {
  const addresses: WatchedAddress[] = [];
  const errors: string[] = [];
  const secretMsg = 'That looks like a private key or seed phrase. Never enter it here: only public addresses.';
  if (looksLikeSecret(text)) return { addresses, errors: [secretMsg], secretRejected: true };
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (looksLikeSecret(line) || looksLikeSecret(line.split(/\s+/)[0])) return { addresses: [], errors: [secretMsg], secretRejected: true };
  }
  for (const [i, line] of lines.entries()) {
    const [address, ...rest] = line.split(/\s+/);
    const why = validateAddress(address, network);
    if (why) {
      errors.push(`Line ${i + 1}: ${why}`);
      continue;
    }
    if (addresses.some((w) => w.address === address)) continue;
    if (addresses.length >= MAX_ADDRESSES) {
      errors.push(`Only ${MAX_ADDRESSES} addresses can be watched; extra lines ignored.`);
      break;
    }
    const label = rest.join(' ').slice(0, 20) || `Addr ${addresses.length + 1}`;
    addresses.push({ address, label });
  }
  return { addresses, errors, secretRejected: false };
}

export function formatAddressLines(addresses: WatchedAddress[]): string {
  return addresses.map((a) => `${a.address} ${a.label}`).join('\n');
}

/** Parses a stored config defensively; anything malformed falls back to defaults. */
export function deserializeConfig(raw: string | null | undefined): Config {
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    const o = JSON.parse(raw) as Partial<Config>;
    const network = NETWORKS.includes(o.network as Network) ? (o.network as Network) : DEFAULT_CONFIG.network;
    const fiat = FIATS.includes(o.fiat as Fiat) ? (o.fiat as Fiat) : DEFAULT_CONFIG.fiat;
    const settleConfs =
      typeof o.settleConfs === 'number' && o.settleConfs >= 1 && o.settleConfs <= 6 ? Math.floor(o.settleConfs) : DEFAULT_CONFIG.settleConfs;
    const addresses = Array.isArray(o.addresses)
      ? o.addresses
          .filter((a): a is WatchedAddress => !!a && typeof a.address === 'string' && validateAddress(a.address, network) === null)
          .slice(0, MAX_ADDRESSES)
          .map((a) => ({ address: a.address, label: typeof a.label === 'string' ? a.label.slice(0, 20) : '' }))
      : [];
    return { network, fiat, settleConfs, addresses };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function serializeConfig(c: Config): string {
  return JSON.stringify(c);
}

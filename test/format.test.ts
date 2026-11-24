import { describe, expect, it } from 'vitest';
import { fiatToSats, fit, formatAge, formatFeeRate, formatFiat, formatSats, glyphsSupported, groupThousands, padRightPx, satsToFiat, shortAddr, spread, textWidth } from '../src/format';

describe('numbers', () => {
  it('groups thousands', () => {
    expect(groupThousands(0)).toBe('0');
    expect(groupThousands(977420)).toBe('977,420');
    expect(groupThousands(-1234567)).toBe('-1,234,567');
  });
  it('formats sats, switching to BTC from 0.1 BTC', () => {
    expect(formatSats(25_000)).toBe('25,000 sats');
    expect(formatSats(9_999_999)).toBe('9,999,999 sats');
    expect(formatSats(12_500_000)).toBe('0.125 BTC');
    expect(formatSats(100_000_000)).toBe('1 BTC');
  });
  it('formats fiat without Intl', () => {
    expect(formatFiat(14.946, 'USD')).toBe('$14.95');
    expect(formatFiat(0.6, 'EUR')).toBe('€0.60');
    expect(formatFiat(59_784.4, 'USD')).toBe('$59,784');
    expect(formatFiat(1234.5, 'GBP')).toBe('£1,235');
    expect(formatFiat(9_508_453, 'JPY')).toBe('¥9,508,453');
    expect(formatFiat(3.2, 'CHF')).toBe('CHF 3.20');
  });
  it('converts between sats and fiat', () => {
    expect(satsToFiat(25_000, 60_000)).toBeCloseTo(15);
    expect(fiatToSats(1, 60_000)).toBe(1667);
  });
  it('formats fee rates and ages', () => {
    expect(formatFeeRate(0.123)).toBe('0.1');
    expect(formatFeeRate(2)).toBe('2');
    expect(formatFeeRate(12.6)).toBe('13');
    expect(formatAge(1000)).toBe('now');
    expect(formatAge(42_000)).toBe('42s');
    expect(formatAge(7 * 60_000 + 5)).toBe('7m');
    expect(formatAge(3 * 3_600_000)).toBe('3h');
    expect(formatAge(72 * 3_600_000)).toBe('3d');
  });
  it('shortens addresses', () => {
    expect(shortAddr('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe('bc1qar0…5mdq');
  });
});

describe('pixel layout (G2 firmware font metrics via @evenrealities/pretext)', () => {
  it('fit never exceeds the budget', () => {
    const long = 'A very long line that certainly does not fit into a narrow container at all';
    for (const w of [50, 120, 300, 566]) expect(textWidth(fit(long, w))).toBeLessThanOrEqual(w);
  });
  it('spread right-aligns within the width', () => {
    const s = spread('★ +25,000 sats', '$14.95', 566);
    expect(textWidth(s)).toBeLessThanOrEqual(566);
    expect(textWidth(s)).toBeGreaterThan(566 - 10);
    expect(s.endsWith('$14.95')).toBe(true);
  });
  it('spread truncates the left side when both do not fit', () => {
    const s = spread('x'.repeat(200), 'RIGHT', 200);
    expect(textWidth(s)).toBeLessThanOrEqual(200);
    expect(s.endsWith('RIGHT')).toBe(true);
  });
  it('padRightPx aligns columns', () => {
    expect(textWidth(padRightPx('Fastest', 120))).toBeGreaterThan(114);
    expect(textWidth(padRightPx('Fastest', 120))).toBeLessThanOrEqual(120);
  });
  it('knows which glyphs the firmware font lacks', () => {
    expect(glyphsSupported('● ○ ★ ▶ ▲ ▼ · … ≈ € £ ¥')).toBe(true);
    expect(glyphsSupported('✓')).toBe(false);
  });
});

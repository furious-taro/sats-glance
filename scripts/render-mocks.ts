// Renders the real view output into 576x288 SVG mocks of the G2 display.
// Glyph x-positions use the firmware font metrics from @evenrealities/pretext,
// so layout and alignment match the glasses; glyph shapes are a stand-in font.
// Build + run:  npm run mocks

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config';
import { DEMO_ADDRESS, DEMO_SCRIPT, demoSnapshot } from '../src/demo';
import { CANVAS_H, CANVAS_W, LINE_H, textWidth } from '../src/format';
import { BODY, FOOTER, HEADER, type Box } from '../src/layout';
import { parseFees, parsePrice } from '../src/mempool/parse';
import { initialPayments, reducePayments, type PaymentsState } from '../src/state/payments';
import type { GlassesView } from '../src/types';
import { buildView, type ViewModel } from '../src/views';

const root = resolve(process.argv[2] ?? '.');
const fx = (n: string) => JSON.parse(readFileSync(resolve(root, 'test/fixtures', n), 'utf8'));
const out = resolve(root, 'docs');
mkdirSync(out, { recursive: true });

const GREEN = '#3dff6e';
const ALPHA = [0.25, 0.4, 0.6, 0.8, 1]; // textColor 0..4

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function boxSvg(b: Box, text: string): string {
  const parts: string[] = [];
  if (b.border) {
    parts.push(`<rect x="${b.x + 0.5}" y="${b.y + 0.5}" width="${b.w - 1}" height="${b.h - 1}" rx="6" fill="none" stroke="${GREEN}" stroke-opacity="0.5" stroke-width="${b.border}"/>`);
  }
  const left = b.x + b.padding + b.border;
  const top = b.y + b.padding + b.border;
  text.split('\n').forEach((line, i) => {
    const chars = [...line];
    const xs: number[] = [];
    let prefix = '';
    for (const ch of chars) {
      xs.push(left + textWidth(prefix));
      prefix += ch;
    }
    const keep = chars.map((c, j) => [c, xs[j]] as const).filter(([c]) => c !== ' ');
    if (!keep.length) return;
    const y = top + i * LINE_H + 20;
    parts.push(
      `<text y="${y}" x="${keep.map(([, x]) => x.toFixed(1)).join(' ')}" fill="${GREEN}" fill-opacity="${ALPHA[b.textColor]}">${esc(keep.map(([c]) => c).join(''))}</text>`,
    );
  });
  return parts.join('\n');
}

function svg(v: GlassesView, caption: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H + 26}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H + 26}" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif" font-size="19">
<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="#000"/>
${boxSvg(HEADER, v.header)}
${boxSvg(BODY, v.body)}
${boxSvg(FOOTER, v.footer)}
<rect y="${CANVAS_H}" width="${CANVAS_W}" height="26" fill="#111"/>
<text x="6" y="${CANVAS_H + 18}" fill="#999" font-size="13">${esc(caption)}</text>
</svg>
`;
}

const now = 1_795_556_705_000;
const price = parsePrice(fx('prices.json'), 'USD');
const fees = parseFees(fx('fees.json'));
const base: ViewModel = {
  config: DEFAULT_CONFIG,
  payments: initialPayments(),
  fees,
  price: { ...price, time: now - 60_000 },
  chain: { tipHeight: 977_420, lastBlockTime: now - 4 * 60_000, avgBlockMs: 551_636 },
  page: 'payments',
  demo: false,
  online: true,
  banner: null,
  flash: null,
  now,
};

function demoState(upToMs: number): PaymentsState {
  let s = initialPayments();
  for (const step of DEMO_SCRIPT.filter((d) => d.at <= upToMs)) {
    const snap = demoSnapshot(step, 977_420);
    s = reducePayments(s, { type: 'tip', height: snap.tip }, 3).state;
    s = reducePayments(s, { type: 'snapshot', address: DEMO_ADDRESS, observations: snap.observations, now: now - (upToMs - step.at) }, 3).state;
  }
  return s;
}

const shots: [string, ViewModel, string][] = [
  ['01-first-run', base, 'First run: no address yet (never a blank screen)'],
  ['02-new-payment', { ...base, demo: true, payments: demoState(4_000), banner: '★ NEW +25,000 sats $14.95' }, 'Demo: payment seen in the mempool'],
  ['03-confirming', { ...base, demo: true, payments: demoState(26_000) }, 'Demo: 2/3 conf, RBF-flagged 0-conf, new payment'],
  ['04-settled-dropped', { ...base, demo: true, payments: demoState(44_000), flash: 'Acknowledged' }, 'Demo: settled, replaced (dropped), confirming'],
  ['05-fees', { ...base, page: 'fees' }, 'Fees page (live data captured from mempool.space)'],
  ['06-price', { ...base, page: 'price' }, 'Price page'],
];

for (const [name, m, caption] of shots) {
  writeFileSync(resolve(out, `${name}.svg`), svg(buildView(m), `Mock render of the 576x288 G2 canvas (firmware font metrics) | ${caption}`));
  console.log('wrote', `docs/${name}.svg`);
}

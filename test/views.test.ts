import { measureTextWrap } from '@evenrealities/pretext';
import { describe, expect, it } from 'vitest';
import { glyphsSupported } from '../src/format';
import { BODY, FOOTER, HEADER, innerWidth, maxLines } from '../src/layout';
import { initialPayments, reducePayments } from '../src/state/payments';
import { FIATS, PAGES, type GlassesView } from '../src/types';
import { buildView, type ViewModel } from '../src/views';
import { ADDR, model, obs } from './helpers';

function withPayments(n: number, extra: Partial<ViewModel> = {}): ViewModel {
  let s = reducePayments(initialPayments(), { type: 'tip', height: 1000 }, 3).state;
  s = reducePayments(s, { type: 'snapshot', address: ADDR, observations: [], now: 0 }, 3).state;
  const list = Array.from({ length: n }, (_, i) =>
    obs(i + 1, 123_456_789 - i * 1_000_000, i % 3 === 0 ? null : 1000 - i, { rbf: i % 3 === 0, label: 'A very long label here' }),
  );
  s = reducePayments(s, { type: 'snapshot', address: ADDR, observations: list, now: 1_795_556_000_000 }, 3).state;
  return model({ payments: s, ...extra });
}

const scenarios: [string, ViewModel][] = [
  ['no addresses', model({ config: { ...model().config, addresses: [] } })],
  ['watching, no payments', model()],
  [
    'watching 5 addresses',
    model({
      config: {
        ...model().config,
        addresses: Array.from({ length: 5 }, (_, i) => ({ address: ADDR, label: `Label number ${i}` })),
      },
    }),
  ],
  ['one payment', withPayments(1)],
  ['many payments', withPayments(12)],
  ['banner + flash', withPayments(2, { banner: '★ NEW +123,456,789 sats $73,812.34', flash: 'Offline: retrying automatically' })],
  ['offline demo', withPayments(3, { online: false, demo: true })],
  ['loading', model({ fees: null, price: null, chain: null })],
  ['signet', model({ config: { ...model().config, network: 'signet' } })],
  ...FIATS.map((f): [string, ViewModel] => [`price ${f}`, model({ price: { fiat: f, perBtc: f === 'JPY' ? 9_508_453 : 159_784.12, time: 1 } })]),
];

function check(v: GlassesView): void {
  const boxes = [
    [HEADER, v.header],
    [BODY, v.body],
    [FOOTER, v.footer],
  ] as const;
  for (const [box, text] of boxes) {
    const m = measureTextWrap(text, innerWidth(box));
    expect(m.lineCount, `${box.name} wraps/overflows:\n${text}`).toBeLessThanOrEqual(maxLines(box));
    for (const w of m.lineWidths) expect(w).toBeLessThanOrEqual(innerWidth(box));
    expect(glyphsSupported(text), `${box.name} uses a glyph missing from the G2 font: ${text}`).toBe(true);
    expect(text.length).toBeLessThan(1000); // createStartUpPageContainer content limit
  }
}

describe('every page fits the G2 containers without scrolling, using only firmware glyphs', () => {
  for (const [name, m] of scenarios) {
    for (const page of PAGES) {
      it(`${name} / ${page}`, () => check(buildView({ ...m, page })));
    }
  }
});

describe('content', () => {
  it('shows the empty-state instructions instead of a blank screen', () => {
    const v = buildView(model({ config: { ...model().config, addresses: [] } }));
    expect(v.body).toMatch(/No address to watch yet/);
    expect(v.body).toMatch(/Tap now to run the demo/);
  });

  it('shows amount, fiat value, status and RBF warning for a mempool payment', () => {
    const v = buildView(withPayments(1));
    expect(v.body).toMatch(/★ \+1\.23456789 BTC/);
    expect(v.body).toMatch(/\$73,8\d\d/);
    expect(v.body).toMatch(/in mempool · 0\/3 conf · RBF!/);
  });

  it('marks the page position, network and demo state in the header', () => {
    expect(buildView(model({ page: 'fees' })).header).toMatch(/^○●○ {2}FEES .*BTC · \d\d:\d\d$/);
    expect(buildView(model({ demo: true })).header).toMatch(/DEMO/);
    expect(buildView(model({ online: false })).header).toMatch(/OFFLINE$/);
  });

  it('shows fee rows and the send cost on mainnet only', () => {
    const fees = buildView(model({ page: 'fees' })).body;
    expect(fees).toMatch(/Fastest\s+12 sat\/vB/);
    expect(fees).toMatch(/Block 977,420/);
    expect(fees).toMatch(/Send now ≈ \$1\.01/); // 12 sat/vB * 141 vB at $59,784
    const signet = buildView(model({ page: 'fees', config: { ...model().config, network: 'signet' } })).body;
    expect(signet).not.toMatch(/Send now/);
  });

  it('shows a price ladder', () => {
    const v = buildView(model({ page: 'price' }));
    expect(v.body).toMatch(/1 BTC = \$59,784/);
    expect(v.body).toMatch(/\$1 = 1,673 sats/);
  });
});

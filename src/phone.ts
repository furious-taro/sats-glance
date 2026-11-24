// Phone-side page (the Even App WebView): settings + a live mirror of the glasses text.

import type { App } from './app';
import { formatAddressLines, parseAddressLines } from './config';
import type { Action } from './input';
import { FIATS, type Config, type Fiat, type Network } from './types';
import { buildView, type ViewModel } from './views';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function select(id: string, options: [string, string][], value: string): HTMLSelectElement {
  const s = el('select', { id });
  for (const [v, label] of options) s.append(el('option', { value: v, textContent: label, selected: v === value }));
  return s;
}

export function mountPhoneUI(root: HTMLElement, app: App, glassesConnected: boolean): void {
  root.textContent = '';

  // ----- glasses mirror -----
  const header = el('div', { className: 'g-header' });
  const body = el('div', { className: 'g-body' });
  const footer = el('div', { className: 'g-footer' });
  const screen = el('div', { className: 'g-screen' }, header, body, footer);
  const control = (label: string, action: Action) => {
    const b = el('button', { type: 'button', textContent: label });
    b.addEventListener('click', () => app.handle(action));
    return b;
  };
  const controls = el(
    'div',
    { className: 'controls' },
    control('▲ Swipe up', { type: 'prevPage' }),
    control('Tap', { type: 'tap' }),
    control('Hold', { type: 'refresh' }),
    control('Swipe down ▼', { type: 'nextPage' }),
  );
  const mirrorNote = el('p', {
    className: 'note',
    textContent: glassesConnected
      ? 'Live mirror of the text on your glasses. The buttons do the same as the glasses gestures.'
      : 'Glasses not connected: this is a preview of what the G2 shows (approximate font). The buttons stand in for the glasses gestures.',
  });

  // ----- settings -----
  const c = app.config;
  const network = select('network', [['mainnet', 'Bitcoin mainnet'], ['testnet4', 'Testnet4 (test coins)'], ['signet', 'Signet (test coins)']], c.network);
  const fiat = select('fiat', FIATS.map((f) => [f, f]), c.fiat);
  const settle = select('settle', ['1', '2', '3', '4', '5', '6'].map((n) => [n, `${n} confirmation${n === '1' ? '' : 's'}`]), String(c.settleConfs));
  const addresses = el('textarea', {
    id: 'addresses',
    rows: 4,
    placeholder: 'bc1q... Market stall\nbc1q... Tip jar',
    value: formatAddressLines(c.addresses),
    spellcheck: false,
  });
  addresses.setAttribute('autocapitalize', 'off');
  addresses.setAttribute('autocomplete', 'off');
  const errors = el('ul', { className: 'errors' });
  const saved = el('span', { className: 'saved' });
  const save = el('button', { type: 'submit', textContent: 'Save' });
  const form = el(
    'form',
    { className: 'settings' },
    el('label', { htmlFor: 'addresses', textContent: 'Public addresses to watch (one per line, optional label after a space; max 5)' }),
    addresses,
    errors,
    el('div', { className: 'row' }, el('label', { htmlFor: 'network', textContent: 'Network' }), network),
    el('div', { className: 'row' }, el('label', { htmlFor: 'fiat', textContent: 'Fiat currency' }), fiat),
    el('div', { className: 'row' }, el('label', { htmlFor: 'settle', textContent: 'Settled after' }), settle),
    el('div', { className: 'row' }, save, saved),
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const net = network.value as Network;
    const parsed = parseAddressLines(addresses.value, net);
    errors.textContent = '';
    for (const e of parsed.errors) errors.append(el('li', { textContent: e }));
    if (parsed.secretRejected) addresses.value = ''; // never keep a pasted secret on screen
    if (parsed.errors.length && parsed.addresses.length === 0 && (addresses.value.trim() || parsed.secretRejected)) {
      saved.textContent = 'Not saved';
      return;
    }
    const next: Config = { network: net, fiat: fiat.value as Fiat, settleConfs: Number(settle.value), addresses: parsed.addresses };
    void app.reconfigure(next).then(() => {
      addresses.value = formatAddressLines(next.addresses);
      saved.textContent = `Saved: watching ${next.addresses.length} address${next.addresses.length === 1 ? '' : 'es'}`;
    });
  });

  const demoBtn = el('button', { type: 'button', textContent: 'Start / stop demo' });
  demoBtn.addEventListener('click', () => {
    app.toggleDemo();
  });
  const refreshBtn = el('button', { type: 'button', textContent: 'Refresh now' });
  refreshBtn.addEventListener('click', () => app.handle({ type: 'refresh' }));

  root.append(
    el('h1', { textContent: 'Sats Glance' }),
    el('p', { className: 'tag', textContent: 'Watch-only Bitcoin payments, fees and price on your G2.' }),
    screen,
    controls,
    mirrorNote,
    el('div', { className: 'row' }, demoBtn, refreshBtn),
    el('h2', { textContent: 'Settings' }),
    form,
    el('h2', { textContent: 'Safety' }),
    el(
      'ul',
      { className: 'safety' },
      el('li', { textContent: 'Watch-only: Sats Glance never asks for, stores or sends private keys or seed phrases. It cannot move funds.' }),
      el('li', { textContent: 'Data comes from the public mempool.space API. Your watched addresses are sent to mempool.space to look them up.' }),
      el('li', { textContent: 'For payments of real value, wait for confirmations. A 0-conf payment (especially one flagged RBF) can still be replaced.' }),
      el('li', { textContent: 'No account, no analytics, no tracking. Settings stay on this phone.' }),
    ),
  );

  app.subscribe((m: ViewModel) => {
    const v = buildView(m);
    header.textContent = v.header;
    body.textContent = v.body;
    footer.textContent = v.footer;
  });
}

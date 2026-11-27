# Sats Glance

**Hands-free, watch-only Bitcoin payment and fee watcher for Even Realities G2 smart glasses.**

You sell coffee at a market stall and a customer pays in bitcoin. Instead of pulling out your phone,
you glance up: `★ NEW +25,000 sats $14.95 · in mempool · 0/3 conf`. A minute later it reads `1/3 conf`,
then `settled`. Tap the temple (or the R1 ring) to acknowledge it. Swipe for the current fee rates and BTC price.

Sats Glance is read-only. It never asks for, stores or sends a private key, and it cannot move funds.
Data comes from the public [mempool.space](https://mempool.space) API: no API key, no account, no tracking.

**Demo video (2:08, captions, no audio):** [docs/demo.mp4](docs/demo.mp4)
(also on the [v0.1.1 release](https://github.com/furious-taro/sats-glance/releases/download/v0.1.1/demo.mp4)), recorded in the official Even Hub simulator through its automation API.

**Built for the Heads Up: Even Realities hackathon (Nov 23-29, 2026).** All code in this repository was written
during the hackathon (first commit 2026-11-24). Nothing existed before Nov 23 except the open-source libraries
it uses (Even Hub SDK, @evenrealities/pretext, Vite, Vitest, TypeScript) and the public mempool.space API.

<p>
<img src="docs/sim-1-new-payment.png" width="49%" alt="New payment banner on the G2 display">
<img src="docs/sim-2-confirming-rbf.png" width="49%" alt="Payments page with confirmations and an RBF warning">
<img src="docs/sim-4-fees.png" width="49%" alt="Fees page">
<img src="docs/sim-5-price.png" width="49%" alt="Price page">
</p>

> Screenshots from the official Even Hub simulator (`evenhub-simulator --automation-port`), demo mode,
> captured 2026-11-24. Fees and price are live mempool.space data. See also [first run](docs/sim-0-first-run.png)
> and [replaced payment](docs/sim-3-dropped.png). The older mock renders (`npm run mocks`) are kept in `docs/*.svg`.

## What it does

| Glasses page | Shows |
| --- | --- |
| **Payments** | Up to 5 watched public addresses. Each incoming payment shows amount in sats and fiat, label, status (`in mempool · 0/3 conf` → `1/3 conf` → `settled`), age, an `RBF!` warning when an unconfirmed payment signals replace-by-fee, and `DROPPED/replaced · not paid` if it vanishes from the mempool. ★ = new, ○ = acknowledged. |
| **Fees** | Fastest / 30 min / 1 hour / economy fee rates (sat/vB), cost of a typical 141 vB payment in fiat, block height, time since last block, average block time. |
| **Price** | 1 BTC in your fiat, 1,000 sats in fiat, and how many sats $1 / $10 / $100 buys (USD, EUR, GBP, CAD, CHF, AUD, JPY). |

A new payment pops a banner in the header and jumps to the Payments page, whatever page you were on.
Confirmations and settlement also get a banner. Acknowledgements are saved, so they survive a restart.

### Glasses input (temple touchpads or R1 ring)

| Gesture | Action |
| --- | --- |
| Swipe down / up | Next / previous page |
| Tap | Acknowledge the newest ★ payment (on first run with no address: start the demo) |
| Long press | Refresh everything now |
| Double tap | Exit (system confirmation dialog, `shutDownPageContainer(1)`) |
| Tap, then hold (system contextual menu) | Refresh now · Acknowledge all · Start/stop demo · Show payments / fees / price |

Every gesture gets visible feedback in the dim footer line (`Acknowledged`, `Refreshing...`, `Updated 14:02`, ...).

### Phone side

Opening the app on the phone shows the settings page (the same web view): paste up to 5 public addresses
(optional label after a space), pick the network (mainnet, testnet4, signet), the fiat currency and how many
confirmations count as settled. Above it, a live mirror of the glasses text with four buttons that perform
the same actions as the glasses gestures. Addresses are checked before saving (full bech32/bech32m checksum
for `bc1`/`tb1` addresses; prefix and format for legacy ones). Anything that looks like a private key,
xprv or seed phrase is refused and wiped from the form.

### Demo mode

A scripted, clearly labelled (`DEMO` in the header) sequence that runs through the same state machine as live data:
a 25,000-sat payment appears in the mempool, gets 1, 2, 3 confirmations and settles; an RBF-flagged 4,100-sat
tip appears and is then replaced (shown as dropped); a 120,000-sat payment arrives and confirms. The script takes 44 s;
the final state stays on screen for another 60 s, then live data returns (or stop it earlier from the menu). Fee and price pages keep showing live data during the demo. Start it by tapping on
the first-run screen, from the contextual menu, or with the phone-side button.

## Run it

Requirements: Node.js 20.17+ (22 LTS recommended).

```bash
git clone https://github.com/furious-taro/sats-glance.git
cd sats-glance
npm install
npm run dev            # Vite dev server on http://localhost:5173
```

**In the official simulator** (second terminal; the simulator ships as a dev dependency):

```bash
npm run sim            # = evenhub-simulator http://localhost:5173
```

**In a plain browser:** open http://localhost:5173. With no glasses bridge the page runs in preview mode: the
glasses mirror plus gesture buttons drive the full app.

**On real G2 glasses** (Even Realities app in developer mode, phone on the same Wi-Fi):

```bash
npx evenhub qr --url http://<your-lan-ip>:5173   # scan with the Even app
```

**Package:** `npm run build && npm run pack:ehpk` → `sats-glance.ehpk`. A prebuilt package is attached to the
[GitHub release](https://github.com/furious-taro/sats-glance/releases).

**Tests:** `npm test` (vitest) and `npm run typecheck`.

## Architecture

```
src/
  main.ts           boot: wait for the bridge (3 s timeout -> preview mode), create the glasses page, wire events
  app.ts            controller: state, polling timers, WebSocket feed, demo, gesture handling, persistence
  glasses.ts        one createStartUpPageContainer, then textContainerUpgrade only for changed containers
  layout.ts         fixed 3-container layout: header 576x36, body 576x216 (event capture, bordered), footer 576x36
  views.ts          pure: state -> text for each container, fitted to pixel widths and line budgets
  format.ts         pure: sats/fiat/fee/age formatting, pixel-accurate fit/align with @evenrealities/pretext
  input.ts          pure: Even Hub events -> actions, contextual menu definition, duplicate-event guard
  state/payments.ts pure: payment state machine (mempool -> confirming -> settled, dropped, reorg-safe)
  mempool/parse.ts  pure: validating parsers for the REST API, net-received sats, BIP-125 RBF detection
  mempool/client.ts REST client + WebSocket block feed with reconnect/backoff
  config.ts         pure: settings, bech32/bech32m validation, secret detection
  demo.ts           scripted demo sequence
  phone.ts          phone-side settings page and glasses mirror
  storage.ts        bridge storage with window.localStorage fallback
```

Design choices:

- **No rebuild flicker.** All three pages share the same three text containers. Changing page or data only sends
  `textContainerUpgrade` for the containers whose text changed. Updates are serialized and coalesced to the latest view.
- **Never scrolls, never clips a glyph.** Every line is fitted to the container's inner width with the firmware's
  font metrics, and the body never exceeds its 7-line budget (27 px line height), so swipes stay page swipes.
  Only glyphs present in the firmware font are used (✓/⚠ are not; ● ○ ★ · ≈ are). Tests check this for every page and state.
- **Data path.** REST polling is the source of truth: addresses every 15 s, chain + fees every 30 s, price every 60 s.
  The mempool.space WebSocket pushes new blocks so confirmations update immediately, and the app subscribes to address
  tracking as a best-effort accelerator that triggers an immediate address refresh. An unconfirmed payment that drops out
  of the address listing is checked with `/tx/:txid/status` before being called dropped, and only after two misses.
- **Startup is calm.** Payments already confirmed when you first add an address count as history (acknowledged).
  Only unconfirmed ones and anything that arrives later are new.
- **Offline-tolerant.** Failed requests keep the last data on screen and show `OFFLINE` in the header until the next good refresh.

## Safety and privacy

- **Watch-only.** The app only handles public addresses. It has no code path to sign or send anything. Private keys,
  WIF keys, xprv/tprv strings and seed-phrase-like input are refused by the settings form.
- **Read-only network use.** Only `GET` requests and WebSocket subscriptions to `mempool.space` (the only origin in the
  app.json whitelist). No other servers, no analytics, no telemetry, no account.
- **Privacy trade-off, stated plainly.** Looking up an address tells mempool.space which addresses you watch (and your IP).
  Use a fresh receiving address per day or event if that matters to you.
- **0-conf is not final.** The UI shows confirmations prominently, warns `RBF!` on replaceable unconfirmed payments, and
  marks vanished ones `DROPPED/replaced · not paid`. Settled means N confirmations (default 3, configurable 1-6).
- **Test networks.** Switch to testnet4 or signet to try it with worthless test coins. The fiat price always comes from mainnet
  and the app says so.
- This is a monitoring aid, not financial advice.

## Testing status

| Check | Status |
| --- | --- |
| Unit tests (`npm test`) | 9 files, 122 tests passing: parsers on captured real API responses, state machine, formatting, pixel-fit of every page with the firmware font metrics, input mapping, SDK page validation (`validateEvenHubPageContainer`), renderer diffing, demo script, controller with a fake API |
| `tsc --noEmit` (strict, SDK typings checked) | clean |
| `vite build` | clean (≈235 kB JS, 74 kB gzipped) |
| `evenhub pack` (CLI 0.2.0, `--sdk-ver 0.0.16`) | produces an 82 kB `.ehpk`, `min_app_version` 2.2.10 |
| Official simulator | **not yet run by the author** (the build environment could not open the simulator window) |
| Real G2 hardware | **not tested** (no glasses available) |

## Feature requests for the Even Hub API

Things we hit while building this, most important first:

1. **Glanceable alerts without the WebView in front.** A payment watcher is most useful with the phone locked in a pocket.
   There is no way to raise a short notification on the glasses or wake the plugin when the WebView is suspended
   (Android). A `notifyGlasses(text)` call plus an opt-in "background monitor" permission would cover alerting apps.
2. **An attention cue.** No haptics or audio output means a new payment can only be signalled by changing text. A short
   system-drawn flash or the phone's notification sound via the bridge would help.
3. **Typings that accept plain objects.** `createStartUpPageContainer`, `menuObject`, etc. are typed as classes with a
   required `toJson()`, so the docs' own object-literal examples (for example `menuObject: { menuItems: [...] }`) do not
   compile under `tsc --strict`. Accepting `Partial<...>` interfaces would fix this.
4. **Right alignment and tab stops in text containers.** Right-aligning amounts needs space padding calculated with
   `@evenrealities/pretext`. A per-container `textAlign` or tab stops would remove that, and a larger font size option
   would make the key number (the amount) readable at a glance.
5. **WebSocket origins in the network whitelist.** The docs describe `https://` origins only. Please document whether
   `wss://` origins must be listed separately. We list both `https://mempool.space` and `wss://mempool.space`, and `evenhub pack` accepts that.
6. **User-supplied endpoints.** The whitelist is fixed at pack time, so a privacy-minded user cannot point the app at their
   own mempool/Esplora server. A user-approved "add origin" prompt at runtime would make self-hosting possible.
7. **Host detection.** A documented `isEvenAppHost()` (or a rejecting `waitForEvenAppBridge` outside the app) would let a
   page choose between glasses mode and browser preview without a timeout race.
8. **`getLocalStorage` for missing keys.** It returns `Promise<string>`, so a missing key cannot be told apart from an empty
   value. Returning `null` for missing keys would be clearer.
9. **Swipe semantics on non-scrolling text.** Please document that a capture container whose text fits emits
   `SCROLL_TOP_EVENT` / `SCROLL_BOTTOM_EVENT` on every swipe. Page navigation like ours depends on it.
10. **Long-press source.** Long-press events arrive on `sysEvent` without `eventSource`, so ring and temple long presses
    cannot be told apart, while taps can.

## License

MIT. Not affiliated with Even Realities or mempool.space.

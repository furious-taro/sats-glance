import { StartUpPageCreateResult, waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { App } from './app';
import { GlassesRenderer } from './glasses';
import { createDeduper, mapEvent } from './input';
import { mountPhoneUI } from './phone';
import { createStorage } from './storage';
import { buildView } from './views';
import './style.css';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function connectGlasses(app: App, bridge: EvenAppBridge): Promise<boolean> {
  const renderer = new GlassesRenderer(bridge);
  const result = await withTimeout(renderer.start(buildView(app.model())), 5000).catch((e) => {
    console.warn('[sats-glance] createStartUpPageContainer threw', e);
    return null;
  });
  if (result !== StartUpPageCreateResult.success) {
    console.warn('[sats-glance] glasses page not created (result:', result, ') - phone preview only');
    return false;
  }
  app.subscribe((m) => renderer.render(buildView(m)));
  const fresh = createDeduper();
  bridge.onEvenHubEvent((e) => {
    const action = mapEvent(e);
    if (!fresh(action, Date.now())) return;
    if (app.handle(action)) void renderer.exit();
  });
  return true;
}

async function boot(): Promise<void> {
  // Inside the Even App (or the simulator) the bridge resolves quickly; in a plain browser we fall back to preview mode.
  const bridge = await withTimeout(waitForEvenAppBridge(), 3000).catch(() => null);
  const app = new App(createStorage(bridge));
  await app.load();
  const glasses = bridge ? await connectGlasses(app, bridge) : false;
  mountPhoneUI(document.getElementById('app') as HTMLElement, app, glasses);
  app.start();
  console.log(`[sats-glance] ready (glasses: ${glasses ? 'connected' : 'preview only'})`);
}

void boot();

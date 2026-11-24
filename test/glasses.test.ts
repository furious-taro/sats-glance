import { StartUpPageCreateResult, isMenuNameWithinLimit, validateEvenHubPageContainer, type EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { describe, expect, it } from 'vitest';
import { GlassesRenderer, startupPage } from '../src/glasses';
import { MENU_ITEMS } from '../src/input';
import { BODY, FOOTER, HEADER } from '../src/layout';
import { CANVAS_H, CANVAS_W } from '../src/format';

const view = { header: 'h', body: 'b', footer: 'f' };

describe('startup page', () => {
  it("passes the SDK's own page validation", () => {
    const page = startupPage(view);
    expect(validateEvenHubPageContainer(page)).toEqual({ valid: true });
    expect(page.containerTotalNum).toBe(3);
  });

  it('has exactly one event-capturing container', () => {
    const page = startupPage(view);
    expect(page.textObject?.filter((t) => t.isEventCapture === 1).map((t) => t.containerName)).toEqual([BODY.name]);
  });

  it('stays inside the 576x288 canvas with unique ids and short names', () => {
    const boxes = [HEADER, BODY, FOOTER];
    for (const b of boxes) {
      expect(b.x + b.w).toBeLessThanOrEqual(CANVAS_W);
      expect(b.y + b.h).toBeLessThanOrEqual(CANVAS_H);
      expect(b.name.length).toBeLessThanOrEqual(16);
    }
    expect(new Set(boxes.map((b) => b.id)).size).toBe(3);
    expect(HEADER.y + HEADER.h).toBeLessThanOrEqual(BODY.y);
    expect(BODY.y + BODY.h).toBeLessThanOrEqual(FOOTER.y);
  });

  it('declares a valid contextual menu', () => {
    expect(MENU_ITEMS.length).toBeLessThanOrEqual(10);
    for (const m of MENU_ITEMS) expect(isMenuNameWithinLimit(m.itemName)).toBe(true);
  });
});

describe('GlassesRenderer', () => {
  function fakeBridge() {
    const calls: { method: string; arg: unknown }[] = [];
    const bridge = {
      createStartUpPageContainer: async (arg: unknown) => {
        calls.push({ method: 'create', arg });
        return StartUpPageCreateResult.success;
      },
      textContainerUpgrade: async (arg: { containerName?: string; content?: string }) => {
        calls.push({ method: 'upgrade', arg });
        return true;
      },
      shutDownPageContainer: async (mode: number) => {
        calls.push({ method: 'shutdown', arg: mode });
        return true;
      },
    } as unknown as EvenAppBridge;
    return { bridge, calls };
  }

  it('creates once, then upgrades only the containers whose text changed', async () => {
    const { bridge, calls } = fakeBridge();
    const r = new GlassesRenderer(bridge);
    expect(await r.start(view)).toBe(StartUpPageCreateResult.success);
    r.render({ ...view, body: 'b2' });
    await new Promise((res) => setTimeout(res, 0));
    const ups = calls.filter((c) => c.method === 'upgrade').map((c) => c.arg as { containerName: string; content: string });
    expect(ups).toEqual([expect.objectContaining({ containerName: BODY.name, content: 'b2' })]);
  });

  it('coalesces bursts to the latest view', async () => {
    const { bridge, calls } = fakeBridge();
    const r = new GlassesRenderer(bridge);
    await r.start(view);
    r.render({ ...view, footer: '1' });
    r.render({ ...view, footer: '2' });
    r.render({ ...view, footer: '3' });
    await new Promise((res) => setTimeout(res, 0));
    const contents = calls.filter((c) => c.method === 'upgrade').map((c) => (c.arg as { content: string }).content);
    expect(contents[contents.length - 1]).toBe('3');
    expect(contents.length).toBeLessThanOrEqual(2);
  });

  it('exits through the system confirmation dialog (mode 1)', async () => {
    const { bridge, calls } = fakeBridge();
    await new GlassesRenderer(bridge).exit();
    expect(calls).toEqual([{ method: 'shutdown', arg: 1 }]);
  });
});

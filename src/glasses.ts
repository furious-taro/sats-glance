// Renders GlassesView to the G2 through the Even Hub SDK.
// One createStartUpPageContainer at boot, then only textContainerUpgrade
// for containers whose text actually changed (flicker-free on hardware).

import {
  CreateStartUpPageContainer,
  MenuContainerProperty,
  MenuItemProperty,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk';
import { MENU_ITEMS } from './input';
import { BODY, FOOTER, HEADER, type Box } from './layout';
import type { GlassesView } from './types';

type Key = keyof GlassesView;
const BOXES: Record<Key, Box> = { header: HEADER, body: BODY, footer: FOOTER };

export function textContainer(b: Box, content: string, capture: boolean): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: b.x,
    yPosition: b.y,
    width: b.w,
    height: b.h,
    borderWidth: b.border,
    borderColor: b.border ? 8 : 0,
    borderRadius: b.border ? 6 : 0,
    paddingLength: b.padding,
    containerID: b.id,
    containerName: b.name,
    content,
    textColor: b.textColor,
    isEventCapture: capture ? 1 : 0,
  });
}

/** The startup page: header, body (the one event-capturing container), footer, plus the contextual menu. */
export function startupPage(view: GlassesView): CreateStartUpPageContainer {
  return new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [textContainer(HEADER, view.header, false), textContainer(BODY, view.body, true), textContainer(FOOTER, view.footer, false)],
    // The typings want class instances (with toJson); the docs' plain object literals do not type-check.
    menuObject: new MenuContainerProperty({ menuItems: MENU_ITEMS.map((i) => new MenuItemProperty(i)) }),
  });
}

export class GlassesRenderer {
  private shown: GlassesView | null = null;
  private pending: GlassesView | null = null;
  private busy = false;

  constructor(private bridge: EvenAppBridge) {}

  async start(view: GlassesView): Promise<StartUpPageCreateResult> {
    const result = await this.bridge.createStartUpPageContainer(startupPage(view));
    if (result === StartUpPageCreateResult.success) this.shown = { ...view };
    return result;
  }

  /** Coalescing, serialized updates: only the latest view is sent. */
  render(view: GlassesView): void {
    this.pending = view;
    if (!this.busy) void this.flush();
  }

  private async flush(): Promise<void> {
    this.busy = true;
    try {
      while (this.pending && this.shown) {
        const view = this.pending;
        this.pending = null;
        for (const key of Object.keys(BOXES) as Key[]) {
          if (view[key] === this.shown[key]) continue;
          const b = BOXES[key];
          const ok = await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({ containerID: b.id, containerName: b.name, content: view[key] }),
          );
          if (ok) this.shown[key] = view[key];
          else console.warn('[sats-glance] textContainerUpgrade failed for', b.name);
        }
      }
    } catch (e) {
      console.warn('[sats-glance] glasses update failed', e);
    } finally {
      this.busy = false;
    }
  }

  exit(): Promise<boolean> {
    // Mode 1: system exit-confirmation dialog (required on the root page).
    return this.bridge.shutDownPageContainer(1);
  }
}

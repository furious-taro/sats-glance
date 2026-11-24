// Maps raw Even Hub events (temple touchpads, R1 ring, contextual menu) to app actions (pure).

import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk';

export type Action =
  | { type: 'nextPage' }
  | { type: 'prevPage' }
  | { type: 'tap' }
  | { type: 'refresh' }
  | { type: 'exit' }
  | { type: 'menu'; id: number }
  | { type: 'none' };

export const MENU = {
  refresh: 1,
  ackAll: 2,
  toggleDemo: 3,
  payments: 4,
  fees: 5,
  price: 6,
} as const;

/** Contextual menu (tap, then hold). Labels are verbs: the OS never re-renders them. */
export const MENU_ITEMS = [
  { itemID: MENU.refresh, itemName: 'Refresh now' },
  { itemID: MENU.ackAll, itemName: 'Acknowledge all' },
  { itemID: MENU.toggleDemo, itemName: 'Start/stop demo' },
  { itemID: MENU.payments, itemName: 'Show payments' },
  { itemID: MENU.fees, itemName: 'Show fees' },
  { itemID: MENU.price, itemName: 'Show price' },
];

function gesture(type: OsEventTypeList | undefined, fromText: boolean): Action {
  switch (type) {
    case OsEventTypeList.CLICK_EVENT:
      return { type: 'tap' };
    case undefined:
      // The SDK normalizes CLICK (0) to undefined on text/list events.
      return fromText ? { type: 'tap' } : { type: 'none' };
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return { type: 'exit' };
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return { type: 'nextPage' };
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return { type: 'prevPage' };
    case OsEventTypeList.LONG_PRESS_EVENT:
      return { type: 'refresh' };
    default:
      // LONG_PRESS_RELEASE, FOREGROUND_ENTER/EXIT (menu overlay), IMU, exits: no action.
      return { type: 'none' };
  }
}

export function mapEvent(e: EvenHubEvent): Action {
  if (e.menuItemClickEvent?.itemID !== undefined) return { type: 'menu', id: e.menuItemClickEvent.itemID };
  if (e.textEvent) return gesture(e.textEvent.eventType, true);
  if (e.listEvent) return gesture(e.listEvent.eventType, true);
  if (e.sysEvent && !e.sysEvent.imuData) return gesture(e.sysEvent.eventType, false);
  return { type: 'none' };
}

/**
 * Some hosts may deliver one physical gesture on more than one event channel
 * (e.g. textEvent and source-aware sysEvent). Drop repeats of the same action
 * within `windowMs`.
 */
export function createDeduper(windowMs = 250): (a: Action, now: number) => boolean {
  let last: { key: string; at: number } | null = null;
  return (a, now) => {
    if (a.type === 'none') return false;
    const key = a.type === 'menu' ? `menu:${a.id}` : a.type;
    if (last && last.key === key && now - last.at < windowMs) return false;
    last = { key, at: now };
    return true;
  };
}

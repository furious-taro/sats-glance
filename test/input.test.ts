import { MenuItemClickEvent, OsEventTypeList, Sys_ItemEvent, Text_ItemEvent, evenHubEventFromJson } from '@evenrealities/even_hub_sdk';
import { describe, expect, it } from 'vitest';
import { MENU, createDeduper, mapEvent } from '../src/input';

const text = (eventType?: OsEventTypeList) => ({ textEvent: new Text_ItemEvent({ containerID: 2, containerName: 'sg-body', eventType }) });
const sys = (eventType?: OsEventTypeList) => ({ sysEvent: new Sys_ItemEvent({ eventType }) });

describe('mapEvent', () => {
  it('maps temple/ring gestures on the capturing text container', () => {
    expect(mapEvent(text(OsEventTypeList.CLICK_EVENT))).toEqual({ type: 'tap' });
    expect(mapEvent(text(undefined))).toEqual({ type: 'tap' }); // SDK normalizes CLICK to undefined
    expect(mapEvent(text(OsEventTypeList.DOUBLE_CLICK_EVENT))).toEqual({ type: 'exit' });
    expect(mapEvent(text(OsEventTypeList.SCROLL_BOTTOM_EVENT))).toEqual({ type: 'nextPage' });
    expect(mapEvent(text(OsEventTypeList.SCROLL_TOP_EVENT))).toEqual({ type: 'prevPage' });
  });

  it('maps long press (sysEvent) to refresh and ignores the release', () => {
    expect(mapEvent(sys(OsEventTypeList.LONG_PRESS_EVENT))).toEqual({ type: 'refresh' });
    expect(mapEvent(sys(OsEventTypeList.LONG_PRESS_RELEASE_EVENT))).toEqual({ type: 'none' });
  });

  it('ignores menu overlay foreground events and unknown sys events', () => {
    expect(mapEvent(sys(OsEventTypeList.FOREGROUND_ENTER_EVENT))).toEqual({ type: 'none' });
    expect(mapEvent(sys(OsEventTypeList.FOREGROUND_EXIT_EVENT))).toEqual({ type: 'none' });
    expect(mapEvent(sys(undefined))).toEqual({ type: 'none' });
    expect(mapEvent({})).toEqual({ type: 'none' });
  });

  it('maps contextual menu clicks', () => {
    expect(mapEvent({ menuItemClickEvent: new MenuItemClickEvent({ itemID: MENU.toggleDemo }) })).toEqual({ type: 'menu', id: MENU.toggleDemo });
  });

  it('works on events parsed by the SDK from host JSON', () => {
    const e = evenHubEventFromJson({ type: 'textEvent', jsonData: { containerID: 2, containerName: 'sg-body', eventType: 2 } });
    expect(mapEvent(e)).toEqual({ type: 'nextPage' });
    const lp = evenHubEventFromJson({ type: 'sysEvent', jsonData: { eventType: 9 } });
    expect(mapEvent(lp)).toEqual({ type: 'refresh' });
  });

  it('maps a touchpad tap that arrives as a typeless sysEvent with an input source (evenhub-simulator)', () => {
    // Exact payload logged by the simulator for a Click: {"jsonData":{"eventSource":1},"sysEvent":{"eventSource":1}}
    const tap = evenHubEventFromJson({ type: 'sysEvent', jsonData: { eventSource: 1 } });
    expect(mapEvent(tap)).toEqual({ type: 'tap' });
  });
});

describe('createDeduper', () => {
  it('drops the same action delivered twice within the window', () => {
    const fresh = createDeduper(250);
    expect(fresh({ type: 'tap' }, 1000)).toBe(true);
    expect(fresh({ type: 'tap' }, 1100)).toBe(false);
    expect(fresh({ type: 'tap' }, 1400)).toBe(true);
    expect(fresh({ type: 'nextPage' }, 1401)).toBe(true);
    expect(fresh({ type: 'none' }, 2000)).toBe(false);
  });
});

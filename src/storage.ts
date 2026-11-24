// Persistent key/value storage: the Even App bridge storage when running
// inside the Even App, falling back to window.localStorage elsewhere.

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function createStorage(bridge: EvenAppBridge | null): KV {
  const local = {
    get(key: string): string | null {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* storage unavailable: settings last for this session only */
      }
    },
  };
  return {
    async get(key) {
      if (bridge) {
        try {
          const v = await bridge.getLocalStorage(key);
          if (typeof v === 'string' && v !== '') return v;
        } catch {
          /* fall through */
        }
      }
      return local.get(key);
    },
    async set(key, value) {
      local.set(key, value);
      if (bridge) {
        try {
          await bridge.setLocalStorage(key, value);
        } catch {
          /* local copy already written */
        }
      }
    },
  };
}

// Local-first persistence. No account: identity is the record on this device. Each browser
// window can hold its own KIN ("slot", carried in ?k=) so two windows on one laptop are two homes.
// Storage is injected so tests and private-mode browsers (where localStorage throws) still work.

import { newKin, type KinRecord } from '../core/creature';

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

export function browserKV(): KV {
  const mem = new Map<string, string>();
  const ls = (() => {
    try {
      const s = globalThis.localStorage;
      s.setItem('kin:probe', '1');
      s.removeItem('kin:probe');
      return s;
    } catch {
      return null;
    }
  })();
  return {
    get: (k) => (ls ? ls.getItem(k) : mem.get(k) ?? null),
    set: (k, v) => {
      try {
        if (ls) ls.setItem(k, v);
        else mem.set(k, v);
      } catch {
        mem.set(k, v);
      }
    },
    del: (k) => (ls ? ls.removeItem(k) : mem.delete(k)),
  };
}

export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  /** Who may visit: ask each time, auto-accept nearby, or nobody. */
  visits: 'ask' | 'auto' | 'off';
  /** Precise location for the sky (opt-in). Off = coarse timezone location. */
  preciseSky: boolean;
  debug: boolean;
  /** iOS: show the KIN as a Live Activity on the Lock Screen and in the Dynamic Island. */
  liveActivity: boolean;
}

const DEFAULT_SETTINGS: Settings = { sound: true, reducedMotion: false, visits: 'ask', preciseSky: false, debug: false, liveActivity: true };

export class Store {
  constructor(private kv: KV, readonly slot: string) {}

  private key(k: string) {
    return `kin:v1:${this.slot}:${k}`;
  }

  loadKin(now: number): { kin: KinRecord; fresh: boolean } {
    const raw = this.kv.get(this.key('kin'));
    if (raw) {
      try {
        const kin = JSON.parse(raw) as KinRecord;
        if (kin.v === 1 && kin.id && Number.isFinite(kin.seed)) return { kin, fresh: false };
      } catch {
        /* corrupt record: fall through to a new hatch rather than crash */
      }
    }
    const kin = newKin(now);
    this.saveKin(kin);
    return { kin, fresh: true };
  }

  saveKin(k: KinRecord) {
    this.kv.set(this.key('kin'), JSON.stringify(k));
  }

  loadSettings(): Settings {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(this.kv.get(this.key('settings')) ?? '{}') as Partial<Settings>) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(s: Settings) {
    this.kv.set(this.key('settings'), JSON.stringify(s));
  }

  /** Forget this KIN entirely (Settings → "Release"). */
  wipe() {
    this.kv.del(this.key('kin'));
    this.kv.del(this.key('settings'));
  }
}

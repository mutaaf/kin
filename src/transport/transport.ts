// Transports carry envelopes and nothing else. The session layer never knows which one it has,
// so the two-tab demo, the phone relay and (later) native peers share every line of game logic.

import { parseEnvelope, type Envelope } from '../protocol/messages';

export interface Transport {
  readonly kind: string;
  send(env: Envelope): void;
  onMessage(cb: (env: Envelope) => void): () => void;
  close(): void;
}

/** Same-origin tabs and windows on one device. Zero network: works with radios off. */
export class BroadcastTransport implements Transport {
  readonly kind = 'tabs';
  private ch: BroadcastChannel;
  private subs = new Set<(env: Envelope) => void>();

  constructor(private self: string, room = 'kin-room-v1') {
    this.ch = new BroadcastChannel(room);
    this.ch.onmessage = (ev) => {
      const env = parseEnvelope(ev.data);
      if (!env || env.from === this.self || (env.to !== '*' && env.to !== this.self)) return;
      for (const cb of this.subs) cb(env);
    };
  }

  send(env: Envelope) {
    this.ch.postMessage(JSON.stringify(env));
  }

  onMessage(cb: (env: Envelope) => void) {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  close() {
    this.ch.close();
    this.subs.clear();
  }
}

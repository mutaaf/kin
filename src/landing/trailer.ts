// The trailer is not a video. Two real KIN instances run in two phone frames and talk over the
// real protocol (BroadcastChannel, same origin); this director only sends them the same commands
// a person would (pet, visit, recall) plus sky cues, and waits for their events to move on.

type Who = 'a' | 'b';

interface Scene {
  caption: string;
  sub?: string;
  run: (d: Director) => Promise<void>;
}

const PHONE = { w: 390, h: 844 };

export class Director {
  private frames: Record<Who, HTMLIFrameElement>;
  private waiters: { who: Who | '*'; e: string; resolve: () => void }[] = [];
  private peers: Record<Who, number> = { a: 0, b: 0 };
  private ready: Record<Who, boolean> = { a: false, b: false };
  playing = true;
  private epoch = 0;
  private sound = false;
  onCaption: (title: string, sub: string, index: number, total: number) => void = () => {};

  constructor(private stageEl: HTMLElement, private scenes: Scene[] = SCENES) {
    const a = stageEl.querySelector<HTMLIFrameElement>('[data-who="a"] iframe')!;
    const b = stageEl.querySelector<HTMLIFrameElement>('[data-who="b"] iframe')!;
    this.frames = { a, b };
    addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.kin !== 'event') return;
      const who: Who | null = e.source === a.contentWindow ? 'a' : e.source === b.contentWindow ? 'b' : null;
      if (!who) return;
      const ev = String(e.data.e);
      if (ev === 'ready') {
        this.ready[who] = true;
        this.cmd(who, { cmd: 'cinema', on: true });
        if (this.sound) this.cmd(who, { cmd: 'sound', on: true });
      }
      if (ev === 'peers') this.peers[who] = Number(e.data.n) || 0;
      this.waiters = this.waiters.filter((w) => {
        if ((w.who === '*' || w.who === who) && w.e === ev) {
          w.resolve();
          return false;
        }
        return true;
      });
    });
    this.fit();
    addEventListener('resize', () => this.fit());
  }

  /** Load both instances. Slots and seeds are fixed so the trailer cast is always the same pair. */
  load() {
    const shift = this.offsetPx();
    const url = (slot: string, seed: number, name: string, sx: number) =>
      `${import.meta.env.BASE_URL}?embed=1&k=${slot}&seed=${seed}&name=${name}&wx=clear&hour=9&sx=${Math.round(sx)}`;
    this.frames.a.src = url('trailera', 28, 'Lumi', 0);
    this.frames.b.src = url('trailerb', 12, 'Nox', shift);
  }

  /** Where frame B sits relative to A, in the instances' own CSS px (frames are scaled). */
  private offsetPx() {
    const ra = this.frames.a.getBoundingClientRect();
    const rb = this.frames.b.getBoundingClientRect();
    const scale = ra.width / PHONE.w || 1;
    return (rb.left - ra.left) / scale;
  }

  /** Scale the 390×844 phone viewports to the stage, so the app lays out exactly as on a phone. */
  private fit() {
    const box = this.stageEl.getBoundingClientRect();
    const gap = Math.max(14, box.width * 0.025);
    const s = Math.min((box.width - gap) / 2 / (PHONE.w + 28), (box.height - 8) / (PHONE.h + 28), 1);
    this.stageEl.style.setProperty('--phone-scale', String(s));
    this.stageEl.style.setProperty('--phone-gap', `${gap}px`);
  }

  cmd(who: Who | '*', m: Record<string, unknown>) {
    const send = (w: Who) => this.frames[w].contentWindow?.postMessage({ kin: 'cmd', ...m }, location.origin);
    if (who === '*') {
      send('a');
      send('b');
    } else send(who);
  }

  sky(wx: string, hour: number) {
    this.cmd('*', { cmd: 'sky', wx, hour });
  }

  /** Wait for an instance event, or give up after `ms` (the show goes on either way). */
  waitFor(who: Who | '*', e: string, ms = 12000): Promise<void> {
    return new Promise((resolve) => {
      const w = { who, e, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        resolve();
      }, ms);
    });
  }

  async until(cond: () => boolean, ms = 10000) {
    const t0 = performance.now();
    while (!cond() && performance.now() - t0 < ms) await this.sleep(150, true);
  }

  /** Sleep that respects pause: paused time doesn't count. */
  async sleep(ms: number, raw = false) {
    const epoch = this.epoch;
    let left = ms;
    while (left > 0) {
      const step = Math.min(left, 100);
      await new Promise((r) => setTimeout(r, step));
      if (this.epoch !== epoch) throw new Error('restart');
      if (this.playing || raw) left -= step;
    }
  }

  setSound(on: boolean) {
    this.sound = on;
    this.cmd('*', { cmd: 'sound', on });
  }

  async play() {
    await this.until(() => this.ready.a && this.ready.b, 20000);
    for (;;) {
      for (let i = 0; i < this.scenes.length; i++) {
        const s = this.scenes[i]!;
        this.onCaption(s.caption, s.sub ?? '', i, this.scenes.length);
        try {
          await s.run(this);
        } catch {
          return;
        }
      }
    }
  }

  get linked() {
    return this.peers.a > 0 && this.peers.b > 0;
  }
}

export const SCENES: Scene[] = [
  {
    caption: 'Morning. Two screens, two homes.',
    sub: 'Each KIN lives under the sky, hatched from its own seed.',
    run: async (d) => {
      d.sky('clear', 9);
      await d.sleep(2600);
      d.cmd('a', { cmd: 'hop' });
      await d.sleep(1600);
    },
  },
  {
    caption: 'It answers your touch.',
    sub: 'Pet it and it leans in. Every response is chosen, not looped.',
    run: async (d) => {
      d.cmd('a', { cmd: 'pet' });
      await d.sleep(1300);
      d.cmd('b', { cmd: 'pet' });
      await d.sleep(2400);
    },
  },
  {
    caption: 'The weather is real.',
    sub: 'Rain sends it under the mushroom. Wind moves the grass and its ears.',
    run: async (d) => {
      d.sky('rain', 13);
      await d.sleep(4600);
    },
  },
  {
    caption: 'Then it notices the screen next door.',
    sub: 'It walks to the edge, glances back at you, and hops.',
    run: async (d) => {
      d.sky('clear', 16.5);
      await d.until(() => d.linked, 8000);
      await d.sleep(600);
      d.cmd('a', { cmd: 'visit' });
      await d.waitFor('b', 'host:hop_in', 9000);
    },
  },
  {
    caption: 'It crosses. The other KIN decides how to say hello.',
    sub: 'Two renders, one arc in a shared space, the seam crossed mid-air.',
    run: async (d) => {
      await d.waitFor('b', 'host:hosting', 6000);
      await d.sleep(2600);
    },
  },
  {
    caption: 'They play in the snow at dusk.',
    sub: 'The host keeps a lease, never the creature. Ownership never moves.',
    run: async (d) => {
      d.sky('snow', 17.8);
      await d.sleep(5200);
    },
  },
  {
    caption: 'Night falls.',
    sub: 'Fireflies, a real moon, and a garden light that glows a little brighter.',
    run: async (d) => {
      d.sky('clear', 22.5);
      await d.sleep(4200);
    },
  },
  {
    caption: 'Called home, it brings back a memory.',
    sub: '"Visited Nox. Nox was shy at first; Lumi did a happy spin."',
    run: async (d) => {
      d.cmd('a', { cmd: 'recall' });
      await d.waitFor('a', 'owner:home', 9000);
      await d.sleep(3400);
    },
  },
];

// The one integration entry for the world: physics, matter, actors, care and the care UI.
//
// ── Integration for app.ts ─────────────────────────────────────────────────────────────────
// 1. Import, next to the other imports:
//      import { attachWorld } from './world/attach';
// 2. After `const hud = new Hud();` (stage, sfx, view, kv, slot, settings and `kin` all exist):
//      const world = attachWorld({
//        stage, view, kv, slot, sfx,
//        kin: () => kin,
//        setKin: (k) => { kin = k; },
//        toast: (t) => hud.toast(t),
//        reducedMotion: () => settings.reducedMotion,
//      });
// 3. In the render loop `frame()`, after the guests update and before `stage.render()`:
//      world.update(dt, now, t);
// 4. Optional: save on hide, next to the existing `save` listeners:
//      addEventListener('pagehide', () => world.save());
// That's all. Rapier loads itself as a lazy chunk after first paint; until it's ready the stage's
// simple roller keeps the ball working, so the 3-second-to-delight budget is untouched.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import type { KinRecord } from '../core/creature';
import { isReunion } from '../core/care';
import type { KV } from '../persistence/store';
import type { KinView } from '../render/kinView';
import type { Stage } from '../render/stage';
import { CareUI } from '../ui/care';
import { World, type Sounds } from './world';

export interface AttachOptions {
  stage: Stage;
  view: KinView;
  kv: KV;
  slot: string;
  kin: () => KinRecord;
  setKin?: (k: KinRecord) => void;
  sfx?: Sounds;
  toast?: (text: string) => void;
  reducedMotion?: () => boolean;
}

export interface AttachedWorld {
  world: World;
  ui: CareUI;
  /** Resolves when Rapier has loaded and the rigid toys are live. */
  ready: Promise<void>;
  update(dt: number, now: number, t: number): void;
  save(): void;
  dispose(): void;
}

export function attachWorld(o: AttachOptions): AttachedWorld {
  const isHome = () => {
    const k = o.kin();
    return k.hatched && k.placement.kind === 'home' && o.view.visible;
  };
  let ui: CareUI | null = null;
  const toast = (t: string) => (o.toast ? o.toast(t) : ui?.toast(t));
  const world = new World({
    stage: o.stage,
    view: o.view,
    kinSeed: o.kin().seed,
    kinName: () => o.kin().name,
    traits: () => o.kin().traits,
    isHome,
    kv: o.kv,
    slot: o.slot,
    sfx: o.sfx,
    reducedMotion: o.reducedMotion,
    toast,
  });
  ui = new CareUI({ world, stage: o.stage, view: o.view, kinName: () => o.kin().name, isHome, hatched: () => o.kin().hatched });
  const reunion = isReunion(world.care.lastAt, Date.now());

  // Care feeds back into the creature's own drives a little: a fed KIN has more energy, play
  // satisfies curiosity. The brain stays the brain; this just keeps the two models in step.
  world.listeners.add((e) => {
    if (!o.setKin) return;
    const k = o.kin();
    const d = { ...k.drives };
    if (e.type === 'eaten') d.energy = Math.min(1, d.energy + 0.08);
    else if (e.type === 'thrown') d.curious = Math.max(0, d.curious - 0.08);
    else if (e.type === 'befriended') d.social = Math.max(0, d.social - 0.2);
    else return;
    o.setKin({ ...k, drives: d });
  });

  // Rapier: a lazy chunk, loaded once the first frames are on screen.
  const ready = new Promise<void>((resolve) => {
    const load = () =>
      import('./physics')
        .then(({ Physics }) => Physics.load())
        .then((p) => {
          world.attachPhysics(p);
          if (reunion && o.kin().hatched) setTimeout(() => world.reunion(), 800);
          resolve();
        })
        .catch((err) => {
          // No WASM (very old browser, blocked): the garden still lives on the simple roller.
          console.warn('[kin] physics unavailable', err);
          resolve();
        });
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(load, { timeout: 1500 });
    else setTimeout(load, 600);
  });

  return {
    world,
    ui,
    ready,
    update(dt, now, t) {
      world.update(dt, now, t);
      ui!.update(performance.now());
    },
    save: () => world.save(),
    dispose() {
      world.dispose();
      ui!.dispose();
    },
  };
}

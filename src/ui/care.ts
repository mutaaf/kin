// Care, by hand. Everything is direct manipulation with real physics: flick a toy to throw it,
// drag a berry off the plant to the KIN, carry water from the bowl, brush with strokes, tuck in
// with the blanket at night, tap a find to keep it. Long-press the KIN for tricks. Needs show as
// small wordless glyphs that appear only when they matter. The Garden Book keeps everything.

import * as THREE from 'three';
import * as care from '../core/care';
import { tap } from '../platform/native';
import type { Stage } from '../render/stage';
import type { KinView } from '../render/kinView';
import type { Entity, World } from '../world/world';
import { DECOR } from '../render/stage';
import * as V from '../world/views';
import './care.css';

const ICON: Record<care.Need, string> = {
  fullness: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13.5" r="5.5"/><path d="M12 8c0-2 1.5-3.5 3.5-3.5"/></svg>',
  fun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M6.5 10.5c3 1 8 1 11 0M7 14.5c3-1 7-1 10 0"/></svg>',
  clean: '<svg viewBox="0 0 24 24"><path d="M12 4.5c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"/></svg>',
  rest: '<svg viewBox="0 0 24 24"><path d="M16.5 15.5A6.5 6.5 0 0 1 9 5.5a6.5 6.5 0 1 0 7.5 10z"/></svg>',
  affection: '<svg viewBox="0 0 24 24"><path d="M12 18.5s-6.5-3.8-6.5-8.3A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 6.5 2.2c0 4.5-6.5 8.3-6.5 8.3z"/></svg>',
};
const BOOK_ICON = '<svg viewBox="0 0 24 24"><path d="M12 6.5c-2-1.5-4.5-2-7-1.6v12.6c2.5-.4 5 .1 7 1.6 2-1.5 4.5-2 7-1.6V4.9c-2.5-.4-5 .1-7 1.6z"/><path d="M12 6.5v12.6"/></svg>';
const TRICK_NAME: Record<care.Trick, string> = { sit: 'Sit', spin: 'Spin', highfive: 'High five', fetch: 'Fetch', roll: 'Roll over', dance: 'Dance' };
const KIND_COLOR: Record<care.ItemKind, string> = {
  pebble: '#D8D4CC', shell: '#F6E4D8', seed: '#8C6A4A', feather: '#C9D0FF', leaf: '#E07A3C', crystal: '#BFF5E6', acorn: '#B47A45',
};

export interface CareUIDeps {
  world: World;
  stage: Stage;
  view: KinView;
  kinName: () => string;
  isHome: () => boolean;
  hatched: () => boolean;
}

interface DragState {
  e: Entity;
  kind: 'body' | 'tool' | 'feather' | 'drop';
  pts: { x: number; y: number; z: number; t: number }[];
  lift: number;
  brushed: number;
  lastOverKin: boolean;
  pointerId: number;
}

export class CareUI {
  private layer: HTMLDivElement;
  private needs = new Map<care.Need, HTMLButtonElement>();
  private tricks: HTMLButtonElement[] = [];
  private bookBtn: HTMLButtonElement;
  private book: HTMLElement | null = null;
  private toastEl: HTMLDivElement;
  private toastT = 0;
  private drag: DragState | null = null;
  private press: { x: number; y: number; t: number; id: number; timer: number } | null = null;
  private ringUntil = 0;
  private drop: THREE.Mesh | null = null;
  private off: (() => void)[] = [];

  constructor(private d: CareUIDeps) {
    this.layer = document.createElement('div');
    this.layer.className = 'care-layer';
    document.body.append(this.layer);
    for (const n of care.NEEDS) {
      const b = document.createElement('button');
      b.className = 'need';
      b.innerHTML = ICON[n];
      b.setAttribute('aria-label', { fullness: 'Hungry: pick a berry from the plant', fun: 'Wants to play: throw a toy', clean: 'Wants a bath: bring water from the bowl', rest: 'Sleepy', affection: 'Wants affection: pet or brush' }[n]);
      b.addEventListener('click', () => this.hintFor(n));
      this.layer.append(b);
      this.needs.set(n, b);
    }
    this.bookBtn = document.createElement('button');
    this.bookBtn.className = 'book-btn';
    this.bookBtn.innerHTML = BOOK_ICON;
    this.bookBtn.setAttribute('aria-label', 'Garden Book: collection, tricks and garden');
    this.bookBtn.addEventListener('click', () => (this.book ? this.closeBook() : this.openBook()));
    this.layer.append(this.bookBtn);
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'care-toast';
    this.toastEl.setAttribute('role', 'status');
    this.layer.append(this.toastEl);

    // Capture phase on the canvas: we see the pointer before the app's pet/tap/stitch handlers,
    // and swallow it only when it grabs something.
    const c = d.stage.renderer.domElement;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    c.addEventListener('pointerdown', down, { capture: true });
    c.addEventListener('pointermove', move, { capture: true });
    c.addEventListener('pointerup', up, { capture: true });
    c.addEventListener('pointercancel', up, { capture: true });
    this.off.push(() => {
      c.removeEventListener('pointerdown', down, { capture: true });
      c.removeEventListener('pointermove', move, { capture: true });
      c.removeEventListener('pointerup', up, { capture: true });
      c.removeEventListener('pointercancel', up, { capture: true });
    });
    const onWorld = (e: { type: string }) => {
      if (e.type === 'care' && this.book) this.renderBook();
      if (e.type === 'found') this.bookBtn.classList.add('on');
    };
    d.world.listeners.add(onWorld);
    this.off.push(() => d.world.listeners.delete(onWorld));
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => this.toastEl.classList.remove('on'), 3000);
  }

  // ───────────── per frame: glyphs and the trick ring follow the KIN

  update(now: number) {
    const home = this.d.isHome() && this.d.hatched();
    this.bookBtn.classList.toggle('on', this.d.hatched());
    const hit = this.d.view.screenHit();
    const wants = home && !this.drag ? care.wants(this.d.world.care) : [];
    let i = 0;
    for (const [n, b] of this.needs) {
      const on = wants.includes(n);
      b.classList.toggle('on', on);
      if (on) {
        const side = i++ % 2 ? -1 : 1;
        b.style.left = `${hit.x + side * (hit.r + 18)}px`;
        b.style.top = `${hit.y - hit.r * 0.6}px`;
      }
    }
    if (this.tricks.length) {
      const show = now < this.ringUntil && home;
      this.tricks.forEach((t, k) => {
        const a = -Math.PI / 2 + ((k - (this.tricks.length - 1) / 2) * Math.PI) / 4.2;
        const R = hit.r + 54;
        // Keep every chip on screen (half a chip from each edge).
        const half = (t.offsetWidth || 90) / 2 + 8;
        t.style.left = `${Math.max(half, Math.min(innerWidth - half, hit.x + Math.cos(a) * R * 1.25))}px`;
        t.style.top = `${Math.max(40, hit.y + Math.sin(a) * R * 0.9)}px`;
        t.classList.toggle('on', show);
      });
      if (!show && now > this.ringUntil + 400) this.closeRing();
    }
  }

  /** The shell (src/ui/shell) owns navigation: hide this layer's own Garden Book button. */
  useShell() {
    this.layer.classList.add('shelled');
  }

  get bookOpen() {
    return !!this.book;
  }

  /**
   * Coach a care verb from the action bar: a soft glowing ring on the real thing to drag or flick
   * (the plant's berries, the ball, the water bowl) plus a one-line hint. Care stays physical;
   * the button only shows you where.
   */
  cue(verb: 'feed' | 'play' | 'bath' | 'rest' | 'love') {
    const w = this.d.world;
    const st = this.d.stage;
    const at: THREE.Vector3 | null =
      verb === 'feed' ? new THREE.Vector3(DECOR.plant.x, 0.42, DECOR.plant.z)
      : verb === 'play' ? st.ballPosition().setY(0.12)
      : verb === 'bath' ? (w.entities.get('bowl')?.obj.position.clone().setY(0.1) ?? null)
      : verb === 'love' ? this.d.view.pos.clone().setY(0.55)
      : new THREE.Vector3(DECOR.nest.x, 0.1, DECOR.nest.z);
    this.hintFor(({ feed: 'fullness', play: 'fun', bath: 'clean', rest: 'rest', love: 'affection' } as const)[verb]);
    if (!at) return;
    const ring = document.createElement('div');
    ring.className = 'cue-ring';
    ring.setAttribute('aria-hidden', 'true');
    this.layer.append(ring);
    const end = performance.now() + 3600;
    const follow = () => {
      if (!ring.isConnected) return;
      const p = st.toScreen(at);
      ring.style.transform = `translate(${p.x}px, ${p.y}px)`;
      if (performance.now() < end) requestAnimationFrame(follow);
      else ring.remove();
    };
    follow();
  }

  /** Tapping a need glyph points at the thing that helps. */
  private hintFor(n: care.Need) {
    const w = this.d.world;
    const target: Record<care.Need, () => void> = {
      fullness: () => (w.care.plant.berries.length ? this.toast('Drag a berry from the glowing plant to feed them.') : this.toast('The plant is growing more berries. Daylight helps.')),
      fun: () => this.toast('Flick the ball (or any toy) to throw it.'),
      clean: () => this.toast('Drag water from the bowl onto them, or let the rain do it.'),
      rest: () => this.toast(w.care.needs.rest < 0.38 && this.isNight() ? 'Drag the blanket onto them to tuck them in.' : 'They’ll nap in the nest when they’re ready.'),
      affection: () => this.toast('Stroke them, or use the brush by the nest.'),
    };
    target[n]();
    tap('light');
  }

  private isNight() {
    return (this.d.stage.palette?.night ?? 0) > 0.6;
  }

  // ───────────── pointer

  private local(e: PointerEvent) {
    const r = this.d.stage.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private screenDist(p: { x: number; y: number }, w: THREE.Vector3) {
    const s = this.d.stage.toScreen(w);
    return Math.hypot(p.x - s.x, p.y - s.y);
  }

  private overKin(p: { x: number; y: number }) {
    const h = this.d.view.screenHit();
    return this.d.isHome() && this.d.view.visible && Math.hypot(p.x - h.x, (p.y - h.y) * 0.9) < h.r * 1.15;
  }

  /** The grabbable thing under the finger, nearest first. */
  private pick(p: { x: number; y: number }): Entity | null {
    const st = this.d.stage;
    let best: Entity | null = null;
    let bd = Infinity;
    for (const e of this.d.world.entities.values()) {
      if (!e.grab || !e.obj.visible) continue;
      const c = e.obj.position.clone();
      c.y += e.r * 0.5;
      const dd = this.screenDist(p, c);
      const lim = Math.max(26, e.r * st.px * 1.3);
      if (dd < lim && dd < bd) (best = e), (bd = dd);
    }
    return best;
  }

  private onDown(e: PointerEvent) {
    if (!this.d.hatched() || this.drag) return;
    const p = this.local(e);
    const w = this.d.world;
    // The trick chips take their own clicks; a tap elsewhere closes the ring.
    if (this.tricks.length) this.closeRing();
    let ent = this.pick(p);
    // Berries hang on the plant: grabbing near the plant picks the ripest one.
    const plantTop = new THREE.Vector3(DECOR.plant.x, 0.42, DECOR.plant.z);
    if (!ent && w.care.plant.berries.length && this.screenDist(p, plantTop) < Math.max(40, 0.35 * this.d.stage.px)) {
      const at = this.d.stage.toWorld(p, 0.4);
      ent = w.pickBerry({ x: at.x, y: 0.4, z: at.z });
      if (ent) tap('light');
    }
    if (!ent) {
      // Long-press on the KIN opens the trick ring (doesn't swallow: petting still works).
      if (this.overKin(p)) {
        const timer = window.setTimeout(() => this.openRing(), 480);
        this.press = { x: p.x, y: p.y, t: performance.now(), id: e.pointerId, timer };
      }
      return;
    }
    e.stopImmediatePropagation();
    e.preventDefault();
    try {
      this.d.stage.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer: dragging still works without capture */
    }
    if (ent.grab === 'collect') return this.collect(ent);
    if (ent.kind === 'blanket' && !this.isNight()) return; // the blanket is for bedtime
    let kind: DragState['kind'] = ent.body ? 'body' : ent.kind === 'feather' ? 'feather' : 'tool';
    // The bowl gives a drop of water, not itself.
    if (ent.kind === 'bowl') {
      const m = V.dropView();
      this.d.stage.world.add(m);
      this.drop = m;
      ent = { id: 'drop', kind: 'drop', obj: m, r: 0.08, grab: 'tool', data: {} };
      kind = 'drop';
    }
    ent.held = true;
    ent.body?.hold(true);
    this.drag = { e: ent, kind, pts: [], lift: ent.kind === 'blanket' ? 0.5 : 0.38, brushed: 0, lastOverKin: false, pointerId: e.pointerId };
    this.dragTo(p, e.timeStamp);
    tap('light');
  }

  private onMove(e: PointerEvent) {
    const p = this.local(e);
    if (this.press && e.pointerId === this.press.id && Math.hypot(p.x - this.press.x, p.y - this.press.y) > 10) {
      clearTimeout(this.press.timer);
      this.press = null;
    }
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    e.stopImmediatePropagation();
    // Under load the browser coalesces moves into one event; replay every sample so a quick flick
    // still has a velocity. Event timestamps, not handling time (handlers can run late).
    const all = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const c of all.length ? all : [e]) this.dragTo(this.local(c), c.timeStamp || e.timeStamp);
  }

  private dragTo(p: { x: number; y: number }, t: number) {
    const dg = this.drag!;
    const w = this.d.stage.toWorld(p, dg.lift);
    w.z = Math.max(-1.3, Math.min(1.45, w.z));
    dg.pts.push({ x: w.x, y: w.y, z: w.z, t });
    if (dg.pts.length > 8) dg.pts.shift();
    if (dg.e.body) dg.e.body.moveTo({ x: w.x, y: w.y, z: w.z });
    else dg.e.obj.position.set(w.x, w.y, w.z);
    if (dg.e.kind === 'feather') this.d.world.holdFeather(w);
    // Brushing: strokes over the KIN count.
    const over = this.overKin(p);
    if (dg.e.kind === 'brush' && over && dg.pts.length > 1) {
      const a = dg.pts[dg.pts.length - 2]!;
      dg.brushed += Math.hypot(w.x - a.x, w.z - a.z) + Math.abs(w.y - a.y);
      if (dg.brushed > 0.5) {
        dg.brushed = 0;
        this.d.world.brushStroke();
        tap('light');
      }
    }
    if (dg.e.kind === 'feather' && over && !dg.lastOverKin) this.d.world.tickle();
    dg.lastOverKin = over;
  }

  private onUp(e: PointerEvent) {
    if (this.press && e.pointerId === this.press.id) {
      clearTimeout(this.press.timer);
      this.press = null;
    }
    const dg = this.drag;
    if (!dg || e.pointerId !== dg.pointerId) return;
    e.stopImmediatePropagation();
    const p = this.local(e);
    const w = this.d.world;
    const ent = dg.e;
    ent.held = false;
    const over = this.overKin(p);
    // Throw velocity from the last ~90 ms of the drag. If the samples are sparse (coalesced), use
    // the previous one; if the finger had come to rest before letting go, it's a drop, not a throw.
    this.dragTo(p, e.timeStamp);
    this.drag = null;
    const pts = dg.pts;
    const b = pts[pts.length - 1]!;
    let a = pts.find((q) => b.t - q.t < 90 && q !== b) ?? pts[pts.length - 2] ?? b;
    if (b.t - a.t > 250) a = b;
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    let vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt;
    const sp = Math.hypot(vx, vz);
    const max = 9;
    if (sp > max) (vx *= max / sp), (vz *= max / sp);
    const speed = Math.min(max, sp);

    switch (dg.kind) {
      case 'body': {
        if (ent.kind === 'berry' && over) {
          // Feed: the KIN chomps it.
          ent.body?.hold(false);
          w.removeEntity(ent.id);
          w.eat((ent.data.ripeness as number) ?? 1);
          tap('medium');
          return;
        }
        ent.body!.hold(false);
        ent.body!.setVel({ x: vx, y: 1.2 + speed * 0.35, z: vz });
        if (speed > 1.6) {
          w.emit({ type: 'thrown', id: ent.id, speed });
          w.apply(care.play(w.care, Date.now(), 'throw'));
          if (ent.kind === 'ball' || ent.kind === 'jelly' || ent.kind === 'placed') w.requestFetch(ent.id);
        }
        return;
      }
      case 'feather':
        w.releaseFeather({ x: vx * 0.4, y: 0.2, z: vz * 0.4 });
        return;
      case 'drop': {
        const pt = this.d.stage.toWorld(p, 0);
        const plant = new THREE.Vector3(DECOR.plant.x, 0.3, DECOR.plant.z);
        if (over) w.bath();
        else if (this.screenDist(p, plant) < 0.5 * this.d.stage.px) w.waterTarget('plant');
        else {
          const plot = w.care.plots.findIndex((_, i) => w.plotPos(i).distanceTo(new THREE.Vector3(pt.x, 0, pt.z)) < 0.28);
          if (plot >= 0) w.waterTarget(plot);
        }
        if (this.drop) this.d.stage.world.remove(this.drop);
        this.drop = null;
        tap('light');
        return;
      }
      case 'tool': {
        if (ent.kind === 'blanket' && over) w.tuckIn();
        else if (ent.kind === 'brush' && over) w.brushStroke();
        // Tools go home with a little glide.
        const from = ent.obj.position.clone();
        const to = new THREE.Vector3(ent.home!.x, ent.home!.y, ent.home!.z);
        const t0 = performance.now();
        const glide = () => {
          const k = Math.min(1, (performance.now() - t0) / 450);
          ent.obj.position.lerpVectors(from, to, 1 - (1 - k) ** 3);
          if (k < 1) requestAnimationFrame(glide);
        };
        if (!(ent.kind === 'blanket' && over)) glide();
        return;
      }
    }
  }

  private collect(ent: Entity) {
    const w = this.d.world;
    const id = ent.item!;
    const def = care.itemById(id)!;
    const first = !w.care.collection[id];
    w.apply(care.collect(w.care, Date.now(), id));
    // A light flies from the find to the book.
    const s = this.d.stage.toScreen(ent.obj.position);
    const r = this.d.stage.renderer.domElement.getBoundingClientRect();
    const fly = document.createElement('div');
    fly.className = 'fly';
    fly.style.left = `${s.x + r.left}px`;
    fly.style.top = `${s.y + r.top}px`;
    fly.style.background = KIND_COLOR[def.kind];
    this.layer.append(fly);
    const br = this.bookBtn.getBoundingClientRect();
    requestAnimationFrame(() => {
      fly.style.transform = `translate(${br.left + br.width / 2 - s.x - r.left}px, ${br.top + br.height / 2 - s.y - r.top}px) scale(0.5)`;
      fly.style.opacity = '0.2';
    });
    setTimeout(() => {
      fly.remove();
      this.bookBtn.classList.remove('ping');
      void this.bookBtn.offsetWidth;
      this.bookBtn.classList.add('ping');
    }, 700);
    w.removeEntity(ent.id);
    this.toast(`${def.name}${first ? ' · new!' : ''}  ${'•'.repeat(def.rarity)}`);
    tap('medium');
  }

  // ───────────── tricks

  openRing() {
    this.press = null;
    const w = this.d.world;
    this.closeRing();
    for (const t of care.TRICKS) {
      if (!care.canTeach(w.care, t)) continue;
      const b = document.createElement('button');
      b.className = 'trick';
      b.innerHTML = `${TRICK_NAME[t]}<span class="skill"><i style="width:${Math.round(w.care.skills[t] * 100)}%"></i></span>`;
      b.setAttribute('aria-label', `${TRICK_NAME[t]}, skill ${Math.round(w.care.skills[t] * 100)} percent`);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.closeRing();
        w.performTrick(t);
        tap('light');
      });
      this.layer.append(b);
      this.tricks.push(b);
    }
    this.ringUntil = performance.now() + 5000;
    tap('medium');
  }

  private closeRing() {
    for (const t of this.tricks) t.remove();
    this.tricks = [];
  }

  // ───────────── the Garden Book

  openBook() {
    this.book = document.createElement('section');
    this.book.className = 'book';
    this.book.setAttribute('role', 'dialog');
    this.book.setAttribute('aria-label', 'Garden Book');
    this.layer.append(this.book);
    this.renderBook();
  }

  closeBook() {
    this.book?.remove();
    this.book = null;
  }

  private renderBook() {
    const el = this.book;
    if (!el) return;
    const w = this.d.world;
    const c = w.care;
    const bond = care.bondLevel(c.bondXp);
    const pct = bond.into / bond.need;
    const C = 2 * Math.PI * 22;
    const found = care.CATALOG.filter((i) => c.firstFound[i.id]).length;
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
    el.innerHTML = `
      <button class="close" aria-label="Close">Close</button>
      <h2>${esc(this.d.kinName())}'s garden</h2>
      <div class="bond">
        <svg viewBox="0 0 54 54"><circle cx="27" cy="27" r="22" fill="none" stroke="rgba(246,246,243,.12)" stroke-width="4"/>
          <circle cx="27" cy="27" r="22" fill="none" stroke="#6EE5CA" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 27 27)"/>
          <text x="27" y="32" text-anchor="middle" fill="#F6F6F3" font-size="15" font-family="Fraunces Variable, Georgia, serif">${bond.level}</text></svg>
        <div><b>${esc(bond.name)}</b><small>${Math.round(bond.into)} / ${bond.need} toward the next level. Care, play and time together all count.</small></div>
      </div>
      <div class="lbl">Tricks · long-press your KIN to ask</div>
      <div class="tricks">${care.TRICKS.map((t) => {
        const open = care.canTeach(c, t);
        return `<div class="tk ${open ? '' : 'locked'}">${TRICK_NAME[t]}<div class="skill"><i style="width:${Math.round(c.skills[t] * 100)}%"></i></div>${open ? '' : `<small>at level ${care.TRICK_UNLOCK[t]}</small>`}</div>`;
      }).join('')}</div>
      <div class="lbl">Garden</div>
      <div class="plots">${c.plots.map((p, i) => `<div class="plot">${p.seed ? esc(care.itemById(p.seed)?.name.replace(' seed', '') ?? 'Sprout') : 'Empty plot'}${p.seed ? `<div class="bar"><i style="width:${Math.round(p.growth * 100)}%"></i></div>` : ''}<small style="display:block;color:rgba(246,246,243,.55);margin-top:4px">${p.seed ? (p.growth >= 1 ? 'In bloom' : p.water < 0.15 ? 'Thirsty' : 'Growing') : `Plot ${i + 1}`}</small></div>`).join('')}</div>
      <div class="lbl">Collection · ${found} of ${care.CATALOG.length}</div>
      <div class="grid">${care.CATALOG.map((it) => {
        const n = c.collection[it.id] ?? 0;
        const seen = !!c.firstFound[it.id];
        const act = n > 0 ? (it.kind === 'seed' ? `<button data-plant="${it.id}">Plant</button>` : `<button data-place="${it.id}">Place</button>`) : '';
        return `<div class="it ${seen ? '' : 'missing'}"><div class="ico" style="background:radial-gradient(circle at 35% 30%, #fff8, ${seen ? KIND_COLOR[it.kind] : '#555'})"></div>${seen ? esc(it.name) : '?'}${n > 1 ? ` ×${n}` : ''}<div class="rar">${'•'.repeat(it.rarity)}</div>${act}</div>`;
      }).join('')}</div>
      <div class="lbl">Together</div>
      <p class="stats">${c.stats.fed} snacks · ${c.stats.baths} baths · ${c.stats.throws} throws · ${c.stats.fetches} fetches · ${c.stats.finds} finds · ${c.stats.friends} new friends</p>`;
    el.querySelector('.close')!.addEventListener('click', () => this.closeBook());
    el.querySelectorAll<HTMLButtonElement>('[data-plant]').forEach((b) =>
      b.addEventListener('click', () => {
        const free = c.plots.findIndex((p) => !p.seed);
        if (free < 0) return this.toast('Every plot is growing something. More plots open as your bond grows.');
        const o = care.plant(w.care, Date.now(), free, b.dataset.plant!);
        if (o) {
          w.apply(o);
          w.syncPlots();
          this.toast('Planted. Water it, or wait for rain.');
          tap('medium');
        }
      }),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.place!;
        const x = (Math.random() - 0.5) * 1.6;
        const z = 0.4 + Math.random() * 0.5;
        if (!w.placeItem(id, x, z)) return;
        this.toast('Placed in the garden. Drag it wherever you like.');
        this.closeBook();
      }),
    );
  }

  dispose() {
    this.off.forEach((f) => f());
    this.layer.remove();
  }
}

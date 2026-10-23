// AR for KIN: the real room is KIN's world on every camera-capable device (Pokémon GO AR+ style),
// chosen from a capability ladder (src/ar/tiers.ts) and the device's live conditions.
//
// ── Integration for app.ts ─────────────────────────────────────────────────────────────────────
// 1. Import:                 import { ArController } from './ar';
// 2. After `const stage = new Stage(...)` and the KinView exist (skip for embeds):
//      const ar = embed ? null : new ArController(stage, kv);
//      void ar?.boot();   // AR by default on capable phones; the habitat elsewhere. Never blocks.
// 3. Taps that aren't on the KIN (the `else if (tap && !view.busy ...)` branch in pointerup):
//      if (ar?.active) { void ar.placeAt(e.clientX, e.clientY); return; }
// 4. The KIN looks at the viewer now and then (in the 4 Hz brain loop, when idle):
//      if (ar?.active && Math.random() < 0.15) view.look = ar.viewerLocal()?.setY(0.6) ?? null;
// 5. Real objects → brain/world (walk to the plant, sniff the cup, sit on the book, hide behind the chair):
//      ar?.on((e) => { if (e.type === 'object-seen') world?.world.noticeReal?.(e.object.label, e.object.local); });
// 6. Physics colliders from the real room (the Realism track implements setEnvironment):
//      ar?.on((e) => { if (e.type === 'surfaces' || e.type === 'mesh') world?.world.physics?.setEnvironment?.(ar.environment); });
// 7. Release KIN / leaving: void ar?.stop();
// Nothing else changes: the creature, world actors and brain keep their local units; the stage
// places and scales the whole world group onto the real surface.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { KV } from '../persistence/store';
import type { Stage } from '../render/stage';
import { nativeAR } from './native';
import { NativeArSession } from './session';
import { chooseTier, DEFAULT_CONDITIONS, TIER_LABEL } from './tiers';
import type { ArCapabilities, ArConditions, ArEnvironment, ArEvent, ArPrefs, ArTier, TierChoice } from './types';
import { CameraView, WebXrSession, webXrSupported } from './web';
import './ar.css';

export type { ArEnvironment, ArEvent, ArTier, TierChoice, ArCapabilities } from './types';
export { chooseTier } from './tiers';

const PREFS_KEY = 'kin:ar:prefs';
const DARK_HOLD_MS = 4000;

export class ArController {
  caps: ArCapabilities | null = null;
  choice: TierChoice = { tier: 'diorama', reason: 'Starting', features: { video: false, planes: false, mesh: false, sceneDepth: false, people: false, meshHz: 0, depthHz: 0 } };
  prefs: ArPrefs;
  private native: NativeArSession | null = null;
  private xr: WebXrSession | null = null;
  private cam: CameraView | null = null;
  private listeners = new Set<(e: ArEvent) => void>();
  private timer = 0;
  private darkSince = 0;
  private brightSince = 0;
  private switching = false;
  private ui: { badge: HTMLButtonElement; menu: HTMLElement; shutter: HTMLButtonElement; fade: HTMLElement } | null = null;

  constructor(private stage: Stage, private kv: KV) {
    const mobile = matchMedia('(pointer: coarse)').matches;
    let saved: Partial<ArPrefs> = {};
    try {
      saved = JSON.parse(kv.get(PREFS_KEY) ?? '{}') as Partial<ArPrefs>;
    } catch {
      /* fresh */
    }
    // AR most of the time on phones and tablets; the habitat by default on desktop.
    this.prefs = { ar: saved.ar ?? (nativeAR.available || mobile), showCamera: saved.showCamera ?? true };
  }

  get active() {
    return this.choice.tier !== 'diorama';
  }

  get tier(): ArTier {
    return this.choice.tier;
  }

  /** The real room for physics (native tiers); null elsewhere. */
  get environment(): ArEnvironment | null {
    return this.native?.active ? this.native : null;
  }

  on(fn: (e: ArEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Detect capabilities, choose the tier, start it. Safe to call once at startup. */
  async boot() {
    this.caps = await this.detect();
    this.mountUi();
    await this.apply(this.decide(), true);
    // Live conditions: re-decide every 2 s (cheap, pure) and switch only when the tier or its
    // features actually change.
    this.timer = window.setInterval(() => void this.reevaluate(), 2000);
  }

  async stop() {
    clearInterval(this.timer);
    await this.teardown();
    this.choice = chooseTier(this.caps ?? this.noCaps(), DEFAULT_CONDITIONS, { ...this.prefs, ar: false });
    this.renderUi();
  }

  async placeAt(x: number, y: number) {
    if (this.native?.active) return this.native.placeAt(x, y);
    return false;
  }

  viewerLocal(): THREE.Vector3 | null {
    if (this.native?.active) return this.native.viewerLocal();
    if (this.xr?.active) return this.xr.viewerLocal();
    if (this.cam?.active) return this.cam.viewerLocal();
    return null;
  }

  /** WebXR drives its own frame loop; the app should run its frame function from here. */
  get ownsLoop() {
    return !!this.xr?.active;
  }

  setAnimationLoop(fn: (t: number) => void) {
    this.xr?.setAnimationLoop(fn);
  }

  async setPrefs(p: Partial<ArPrefs>) {
    this.prefs = { ...this.prefs, ...p };
    this.kv.set(PREFS_KEY, JSON.stringify(this.prefs));
    await this.apply(this.decide(), true);
  }

  // ── ladder ───────────────────────────────────────────────────────────────────────────────

  private async detect(): Promise<ArCapabilities> {
    const s = nativeAR.available ? await nativeAR.support() : null;
    if (s) {
      return {
        native: true, tracking: s.supported, lidar: s.lidar, sceneDepth: s.sceneDepth || s.smoothedSceneDepth, people: s.people,
        camera: !s.hasCamera ? 'none' : s.camera === 2 || s.camera === 1 ? 'denied' : s.camera === 3 ? 'granted' : 'undetermined',
        webxr: false, gyro: true, model: s.model,
      };
    }
    const webxr = await webXrSupported();
    const hasCam = webxr || (await CameraView.hasCamera());
    return {
      native: false, tracking: webxr, lidar: false, sceneDepth: false, people: false,
      camera: hasCam ? 'undetermined' : 'none', webxr,
      gyro: 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches,
    };
  }

  private noCaps(): ArCapabilities {
    return { native: false, tracking: false, lidar: false, sceneDepth: false, people: false, camera: 'none', webxr: false, gyro: false };
  }

  private conditions(): ArConditions {
    const n = this.native;
    const c = n?.conditions;
    const now = performance.now();
    // Darkness must persist (4 s) before it counts, and brightness must persist to come back,
    // so the view never flickers between camera and room at dusk.
    const lm = n?.lumens ?? null;
    if (lm !== null && lm < 60) {
      this.brightSince = 0;
      this.darkSince ||= now;
    } else {
      this.darkSince = 0;
      this.brightSince ||= now;
    }
    const dark = this.darkSince && now - this.darkSince > DARK_HOLD_MS;
    const wasRoomForDark = this.choice.tier === 'room' && this.prefs.showCamera;
    const stillDark = wasRoomForDark && !(this.brightSince && now - this.brightSince > DARK_HOLD_MS);
    return {
      ...DEFAULT_CONDITIONS,
      ...(c ?? {}),
      battery: c?.battery ?? null,
      memoryWarning: !!c?.memoryWarning,
      tracking: n?.tracking ?? 'unknown',
      lumens: dark || stillDark ? 10 : lm,
    };
  }

  private decide(): TierChoice {
    return chooseTier(this.caps ?? this.noCaps(), this.conditions(), this.prefs);
  }

  private async reevaluate() {
    if (this.switching || !this.caps) return;
    const next = this.decide();
    const same = next.tier === this.choice.tier && JSON.stringify(next.features) === JSON.stringify(this.choice.features);
    if (!same) await this.apply(next, false);
  }

  /** Switch tiers with a short cinematic fade; native↔native tiers reconfigure without moving KIN. */
  private async apply(next: TierChoice, fromUser: boolean) {
    if (this.switching) return;
    this.switching = true;
    const prev = this.choice;
    try {
      const nativeTier = (t: ArTier) => t === 'full' || t === 'camera' || t === 'room';
      if (this.native?.active && nativeTier(next.tier) && this.caps?.native) {
        if (prev.tier !== next.tier) await this.fade(async () => this.native!.configure(next.features));
        else await this.native.configure(next.features);
        this.choice = next;
        return;
      }
      if (prev.tier === next.tier && !fromUser && this.active) {
        this.choice = next;
        return;
      }
      await this.fade(async () => {
        await this.teardown();
        this.choice = next;
        if (next.tier === 'diorama') return;
        let ok = false;
        if (this.caps?.native && nativeTier(next.tier)) {
          this.native = new NativeArSession(this.stage, { features: next.features });
          this.native.on((e) => this.forward(e));
          ok = await this.native.start();
          // Camera permission is asked by ARKit itself on first start; re-detect so a "Don't Allow"
          // lands on the habitat with an honest reason.
          if (!ok) this.caps = await this.detect();
        } else if (next.tier === 'camera' && this.caps?.webxr) {
          this.xr = new WebXrSession(this.stage);
          ok = await this.xr.start();
        } else if (next.tier === 'camera-view') {
          this.cam = new CameraView(this.stage);
          ok = await this.cam.start();
        }
        if (!ok) {
          await this.teardown();
          this.choice = chooseTier(this.caps ?? this.noCaps(), DEFAULT_CONDITIONS, { ...this.prefs, ar: false });
          this.choice = { ...this.choice, reason: this.caps?.camera === 'denied' ? 'Camera access is off for KIN' : 'AR could not start here' };
        }
      });
    } finally {
      this.switching = false;
      this.renderUi();
    }
  }

  private async teardown() {
    await this.native?.stop();
    await this.xr?.stop();
    await this.cam?.stop();
    this.native = null;
    this.xr = null;
    this.cam = null;
  }

  private forward(e: ArEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // ── UI: tier badge, "Show camera", shutter, cinematic fade ───────────────────────────────

  private mountUi() {
    if (this.ui) return;
    const badge = document.createElement('button');
    badge.className = 'ar-badge';
    badge.setAttribute('aria-haspopup', 'true');
    const menu = document.createElement('div');
    menu.className = 'ar-menu';
    menu.hidden = true;
    const shutter = document.createElement('button');
    shutter.className = 'ar-shutter';
    shutter.setAttribute('aria-label', 'Take an AR photo');
    const fade = document.createElement('div');
    fade.className = 'ar-fade';
    document.body.append(fade, badge, menu, shutter);
    badge.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      this.renderUi();
    });
    shutter.addEventListener('click', async () => {
      if (!this.native?.active) return;
      shutter.classList.add('flash');
      setTimeout(() => shutter.classList.remove('flash'), 300);
      await this.native.snapshot();
    });
    this.ui = { badge, menu, shutter, fade };
    this.renderUi();
  }

  private renderUi() {
    const ui = this.ui;
    if (!ui) return;
    const t = this.choice.tier;
    ui.badge.innerHTML = `<i class="ar-dot ar-${t}"></i>${TIER_LABEL[t]}`;
    ui.badge.title = this.choice.reason;
    ui.badge.hidden = !this.caps || (t === 'diorama' && this.caps.camera === 'none' && !this.prefs.ar);
    ui.shutter.hidden = !(this.native?.active && t !== 'room');
    if (ui.menu.hidden) return;
    const caps = this.caps!;
    const canRoom = caps.lidar && caps.native;
    ui.menu.innerHTML = `
      <p class="ar-why">${this.choice.reason}</p>
      <button data-k="ar" aria-pressed="${this.prefs.ar}">${this.prefs.ar ? 'Back to the habitat' : 'Bring KIN into your room'}</button>
      ${this.prefs.ar && (caps.native || caps.webxr) ? `<button data-k="cam" aria-pressed="${this.prefs.showCamera}">${this.prefs.showCamera ? (canRoom ? 'Hide camera (room mode)' : 'Hide camera') : 'Show camera'}</button>` : ''}
      <p class="ar-small">The camera picture stays on this device and is never saved or sent. Photos are saved only when you tap the shutter.</p>`;
    ui.menu.querySelector('[data-k="ar"]')?.addEventListener('click', () => void this.setPrefs({ ar: !this.prefs.ar }));
    ui.menu.querySelector('[data-k="cam"]')?.addEventListener('click', () => void this.setPrefs({ showCamera: !this.prefs.showCamera }));
  }

  private async fade(work: () => Promise<unknown>) {
    const f = this.ui?.fade;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!f || reduce) return void (await work());
    f.classList.add('on');
    await new Promise((r) => setTimeout(r, 380));
    await work();
    await new Promise((r) => setTimeout(r, 120));
    f.classList.remove('on');
  }
}

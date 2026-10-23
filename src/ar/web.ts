// AR outside the iOS app.
//
//   WebXrSession   Android Chrome (and other WebXR immersive-ar browsers): the real room, real
//                  surfaces through hit-test. Ladder tier 'camera'.
//   CameraView     anything with a camera but no room tracking ("AR+ off"): the live camera behind
//                  the canvas, the view turned by the gyroscope only, KIN on a virtual floor about a
//                  metre ahead. Ladder tier 'camera-view'. It never claims to see real surfaces.

import * as THREE from 'three';
import type { Stage } from '../render/stage';

type XRSessionLike = {
  requestReferenceSpace(t: string): Promise<unknown>;
  requestHitTestSource?(o: { space: unknown }): Promise<{ cancel(): void }> | undefined;
  addEventListener(t: string, fn: (e: unknown) => void): void;
  end(): Promise<void>;
};
type XRFrameLike = {
  getHitTestResults(src: unknown): { getPose(space: unknown): { transform: { position: DOMPointReadOnly } } | null }[];
};

export async function webXrSupported(): Promise<boolean> {
  const xr = (navigator as unknown as { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
  try {
    return !!xr && (await xr.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

export class WebXrSession {
  active = false;
  placed = false;
  private session: XRSessionLike | null = null;
  private hitSource: { cancel(): void } | null = null;
  private refSpace: unknown = null;
  private lastHit: THREE.Vector3 | null = null;
  private loop: ((t: number) => void) | null = null;

  constructor(private stage: Stage) {}

  /** Must be called from a user gesture (browsers require it to enter immersive AR). */
  async start(): Promise<boolean> {
    const xr = (navigator as unknown as { xr?: { requestSession(m: string, o: unknown): Promise<XRSessionLike> } }).xr;
    if (!xr) return false;
    try {
      this.session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'local'],
        optionalFeatures: ['dom-overlay', 'light-estimation'],
        domOverlay: { root: document.body },
      });
    } catch {
      return false;
    }
    const r = this.stage.renderer;
    r.xr.enabled = true;
    r.xr.setReferenceSpaceType('local');
    await r.xr.setSession(this.session as unknown as XRSession);
    this.refSpace = await this.session.requestReferenceSpace('local');
    const viewer = await this.session.requestReferenceSpace('viewer');
    this.hitSource = (await this.session.requestHitTestSource?.({ space: viewer })) ?? null;
    // Tap = place (WebXR delivers screen taps as 'select').
    this.session.addEventListener('select', () => this.placeAtHit());
    this.session.addEventListener('end', () => void this.stop());
    this.stage.arCamera.matrixAutoUpdate = true; // three's XR manager drives this camera
    this.stage.enterAR();
    document.documentElement.classList.add('kin-ar');
    r.setAnimationLoop((t: number, frame?: unknown) => {
      if (frame && this.hitSource) {
        const hits = (frame as XRFrameLike).getHitTestResults(this.hitSource);
        const pose = hits[0]?.getPose(this.refSpace);
        if (pose) {
          const p = pose.transform.position;
          this.lastHit = new THREE.Vector3(p.x, p.y, p.z);
          if (!this.placed) this.placeAtHit();
        }
      }
      this.loop?.(t);
    });
    this.active = true;
    return true;
  }

  /** WebXR owns the frame loop: the app's frame function runs from here while AR is on. */
  setAnimationLoop(fn: (t: number) => void) {
    this.loop = fn;
  }

  private placeAtHit() {
    if (!this.lastHit) return;
    const cam = new THREE.Vector3().setFromMatrixPosition(this.stage.renderer.xr.getCamera().matrixWorld);
    const at = this.lastHit;
    this.stage.placeWorld(at, Math.atan2(cam.x - at.x, cam.z - at.z));
    this.placed = true;
  }

  viewerLocal() {
    const cam = new THREE.Vector3().setFromMatrixPosition(this.stage.renderer.xr.getCamera().matrixWorld);
    return this.stage.world.worldToLocal(cam);
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    this.hitSource?.cancel();
    this.stage.renderer.setAnimationLoop(null);
    try {
      await this.session?.end();
    } catch {
      /* already ended */
    }
    this.stage.renderer.xr.enabled = false;
    this.stage.arCamera.matrixAutoUpdate = false;
    this.stage.exitAR();
    document.documentElement.classList.remove('kin-ar');
  }
}

/** "AR+ off": the camera behind KIN, gyro-only orientation, a virtual floor. */
export class CameraView {
  active = false;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private orient = { alpha: 0, beta: 70, gamma: 0, have: false };
  private onOrient = (e: DeviceOrientationEvent) => {
    if (e.alpha === null) return;
    this.orient = { alpha: e.alpha ?? 0, beta: e.beta ?? 70, gamma: e.gamma ?? 0, have: true };
    this.update();
  };
  private baseAlpha: number | null = null;

  constructor(private stage: Stage) {}

  static async hasCamera(): Promise<boolean> {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices();
      return !!devices?.some((d) => d.kind === 'videoinput');
    } catch {
      return false;
    }
  }

  /** Call from a user gesture (camera and motion permissions). */
  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch {
      return false;
    }
    const v = document.createElement('video');
    v.className = 'ar-video';
    v.playsInline = true;
    v.muted = true;
    v.srcObject = this.stream;
    document.getElementById('stage')?.prepend(v);
    await v.play().catch(() => {});
    this.video = v;
    // iOS Safari asks for motion permission; without it the view simply doesn't turn.
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    let motion = true;
    if (typeof DOE.requestPermission === 'function') motion = (await DOE.requestPermission().catch(() => 'denied')) === 'granted';
    if (motion) addEventListener('deviceorientation', this.onOrient);
    const cam = this.stage.arCamera;
    cam.matrixAutoUpdate = true;
    cam.fov = 62;
    cam.near = 0.01;
    cam.far = 60;
    this.stage.enterAR();
    document.documentElement.classList.add('kin-ar', 'kin-cameraview');
    // KIN a little over a metre ahead, on a floor 1.3 m below the phone, facing you.
    this.stage.placeWorld(new THREE.Vector3(0, -1.3, -1.25), 0);
    this.update();
    this.active = true;
    return true;
  }

  /** Gyro → camera orientation (the standard device-orientation → quaternion mapping). */
  update() {
    const cam = this.stage.arCamera;
    cam.aspect = this.stage.w / Math.max(1, this.stage.h);
    cam.updateProjectionMatrix();
    if (!this.orient.have) {
      cam.position.set(0, 0, 0);
      cam.rotation.set(-0.35, 0, 0); // looking slightly down at the virtual floor
      cam.updateMatrixWorld(true);
      return;
    }
    if (this.baseAlpha === null) this.baseAlpha = this.orient.alpha;
    const rad = THREE.MathUtils.degToRad;
    const euler = new THREE.Euler(rad(this.orient.beta), rad(this.orient.alpha - this.baseAlpha), -rad(this.orient.gamma), 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(euler);
    q.multiply(new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)); // camera looks out the back, not up
    const turn = rad(window.screen?.orientation?.angle ?? 0);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -turn));
    cam.quaternion.copy(q);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
  }

  viewerLocal() {
    return this.stage.world.worldToLocal(new THREE.Vector3(0, 0, 0));
  }

  async stop() {
    this.active = false;
    removeEventListener('deviceorientation', this.onOrient);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video?.remove();
    this.video = null;
    this.stage.arCamera.matrixAutoUpdate = false;
    this.stage.exitAR();
    document.documentElement.classList.remove('kin-ar', 'kin-cameraview');
  }
}

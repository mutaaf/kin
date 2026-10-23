import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BASE_TILT, baseline, CameraDirector, deviceClass, frameFor, spring } from '../src/render/camera';

const phone = { w: 393, h: 852, px: 118 };
const desk = { w: 1536, h: 1024, px: 170 };
const kin = (x = 0, z = 0) => ({ pos: new THREE.Vector3(x, 0, z), size: 1 });

describe('camera director', () => {
  it('classifies devices by their short side', () => {
    expect(deviceClass(phone)).toBe('phone');
    expect(deviceClass({ w: 820, h: 1180 })).toBe('tablet');
    expect(deviceClass(desk)).toBe('desktop');
  });

  it('spotlight makes the KIN command a phone screen and frames more habitat on desktop', () => {
    const p = frameFor('spotlight', [kin()], phone);
    const d = frameFor('spotlight', [kin()], desk);
    // A ~1-unit creature fills over a quarter of the phone's height (its head and ears more).
    expect(1 / p.height).toBeGreaterThan(0.25);
    expect(d.height).toBeGreaterThan(p.height);
    expect(p.tilt).toBeLessThan(BASE_TILT); // a lower, more cinematic angle
  });

  it('closeups are tighter than spotlight, wides are looser, and two subjects stay in frame', () => {
    const s = frameFor('spotlight', [kin()], phone).height;
    expect(frameFor('closeup', [kin()], phone).height).toBeLessThan(s);
    expect(frameFor('wide', [kin()], phone).height).toBeGreaterThan(s);
    const two = frameFor('spotlight', [kin(-1.2), kin(1.2)], phone);
    expect(two.height).toBeGreaterThan(s);
    expect(two.target.x).toBeCloseTo(0, 5);
  });

  it('crossing is exactly the Stage baseline (the seam contract)', () => {
    const c = frameFor('crossing', [kin(1.3, 0.4)], phone);
    const b = baseline(phone);
    expect(c.height).toBeCloseTo(b.height);
    expect(c.tilt).toBe(BASE_TILT);
    expect(c.target.equals(b.target)).toBe(true);
  });

  it('the spring settles without overshoot', () => {
    let x = 0;
    let v = 0;
    let max = 0;
    for (let i = 0; i < 240; i++) {
      [x, v] = spring(x, v, 1, 6, 1 / 60);
      max = Math.max(max, x);
    }
    expect(x).toBeCloseTo(1, 3);
    expect(max).toBeLessThanOrEqual(1.0001);
  });

  it('eases a real orthographic camera back to zoom 1 and the baseline when crossing', () => {
    const cam = new THREE.OrthographicCamera(-1.66, 1.66, 3.6, -3.6, 0.1, 60);
    const d = new CameraDirector({ camera: cam, viewport: () => phone });
    d.follow(() => [kin(0.8, 0.3)]);
    d.update(1 / 60, 0);
    expect(cam.zoom).toBeGreaterThan(2);
    d.setMode('crossing');
    for (let i = 0; i < 180; i++) d.update(1 / 60, i / 60);
    expect(d.atBaseline).toBe(true);
    expect(cam.zoom).toBe(1);
    const b = baseline(phone);
    const look = new THREE.Vector3();
    cam.getWorldDirection(look);
    expect(THREE.MathUtils.radToDeg(Math.asin(-look.y))).toBeCloseTo(BASE_TILT, 3);
    expect(cam.position.x).toBeCloseTo(b.target.x, 6);
  });
});

import { describe, expect, it } from 'vitest';
import { chooseTier, DEFAULT_CONDITIONS } from '../src/ar/tiers';
import type { ArCapabilities, ArConditions, ArPrefs } from '../src/ar/types';

const lidarPhone: ArCapabilities = { native: true, tracking: true, lidar: true, sceneDepth: true, people: true, camera: 'granted', webxr: false, gyro: true, model: 'iPhone16,2' };
const a12Phone: ArCapabilities = { ...lidarPhone, lidar: false, sceneDepth: false, model: 'iPhone11,8' };
const oldPhone: ArCapabilities = { ...a12Phone, people: false };
const android: ArCapabilities = { native: false, tracking: true, lidar: false, sceneDepth: false, people: false, camera: 'granted', webxr: true, gyro: true };
const oldWeb: ArCapabilities = { ...android, tracking: false, webxr: false };
const desktop: ArCapabilities = { native: false, tracking: false, lidar: false, sceneDepth: false, people: false, camera: 'none', webxr: false, gyro: false };
const on: ArPrefs = { ar: true, showCamera: true };
const k = (x: Partial<ArConditions> = {}): ArConditions => ({ ...DEFAULT_CONDITIONS, ...x });

describe('AR capability ladder', () => {
  it('defaults to the live camera on every camera device (Pokémon GO style), never to room mode', () => {
    expect(chooseTier(lidarPhone, k(), on).tier).toBe('full');
    expect(chooseTier(lidarPhone, k(), on).features.video).toBe(true);
    expect(chooseTier(a12Phone, k(), on).tier).toBe('camera');
    expect(chooseTier(android, k(), on).tier).toBe('camera');
    expect(chooseTier(oldWeb, k(), on).tier).toBe('camera-view');
    expect(chooseTier(desktop, k(), on).tier).toBe('diorama');
  });

  it('LiDAR phone, full tier: mesh + scene depth + people occlusion', () => {
    const f = chooseTier(lidarPhone, k(), on).features;
    expect(f).toMatchObject({ video: true, mesh: true, sceneDepth: true, people: true });
    expect(f.depthHz).toBeGreaterThan(0);
  });

  it('room mode only when the player hides the camera or it is too dark, and only with LiDAR', () => {
    expect(chooseTier(lidarPhone, k(), { ar: true, showCamera: false }).tier).toBe('room');
    expect(chooseTier(lidarPhone, k({ lumens: 20 }), on).tier).toBe('room');
    expect(chooseTier(lidarPhone, k({ lumens: 20 }), on).features.video).toBe(false);
    expect(chooseTier(a12Phone, k(), { ar: true, showCamera: false }).tier).toBe('diorama');
    expect(chooseTier(a12Phone, k({ lumens: 20 }), on).tier).toBe('camera'); // dark, no LiDAR: still camera, with a warning
  });

  it('heat, Low Power Mode and battery shed load in order, then drop a tier', () => {
    const warm = chooseTier(lidarPhone, k({ thermal: 'serious' }), on);
    expect(warm.tier).toBe('full');
    expect(warm.features.sceneDepth).toBe(false);
    expect(warm.features.meshHz).toBeLessThan(chooseTier(lidarPhone, k(), on).features.meshHz);
    expect(chooseTier(lidarPhone, k({ lowPower: true }), on).features.sceneDepth).toBe(false);
    expect(chooseTier(lidarPhone, k({ thermal: 'critical' }), on).tier).toBe('camera');
    expect(chooseTier(lidarPhone, k({ battery: 0.05 }), on).tier).toBe('camera');
    expect(chooseTier(lidarPhone, k({ battery: 0.05, charging: true }), on).tier).toBe('full');
    expect(chooseTier(a12Phone, k({ thermal: 'critical' }), on).tier).toBe('diorama');
    expect(chooseTier(a12Phone, k({ thermal: 'serious' }), on).features.people).toBe(false);
  });

  it('memory warnings stop streaming mesh and depth but keep the session', () => {
    const f = chooseTier(lidarPhone, k({ memoryWarning: true }), on);
    expect(f.tier).toBe('full');
    expect(f.features.meshHz).toBe(0);
    expect(f.features.depthHz).toBe(0);
  });

  it('permission, preference and missing hardware all land on the habitat with a reason', () => {
    expect(chooseTier({ ...lidarPhone, camera: 'denied' }, k(), on)).toMatchObject({ tier: 'diorama', reason: expect.stringMatching(/Camera access/) });
    expect(chooseTier(lidarPhone, k(), { ar: false, showCamera: true }).tier).toBe('diorama');
    expect(chooseTier(oldPhone, k(), on).features.people).toBe(false);
    for (const caps of [lidarPhone, a12Phone, android, oldWeb, desktop]) {
      for (const thermal of ['nominal', 'fair', 'serious', 'critical'] as const) {
        for (const showCamera of [true, false]) {
          const r = chooseTier(caps, k({ thermal }), { ar: true, showCamera });
          expect(r.reason.length).toBeGreaterThan(3);
          if (!r.features.video) expect(['room', 'diorama']).toContain(r.tier);
          if (r.tier === 'room') expect(caps.lidar).toBe(true);
        }
      }
    }
  });
});

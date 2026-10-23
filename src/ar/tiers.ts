// The capability ladder as one pure function: what this device has + how it's doing right now +
// what the player chose → which AR tier, which features, and why (the honest badge text).
// Camera image and depth are independent layers. Tested as a matrix in tests/ar.tiers.test.ts.

import type { ArCapabilities, ArConditions, ArFeatures, ArPrefs, TierChoice } from './types';

const OFF: ArFeatures = { video: false, planes: false, mesh: false, sceneDepth: false, people: false, meshHz: 0, depthHz: 0 };

/** Below this ARKit ambient intensity the camera image is mostly noise; LiDAR still sees fine. */
export const DARK_LUMENS = 60;

export const DEFAULT_CONDITIONS: ArConditions = {
  thermal: 'nominal', lowPower: false, battery: null, charging: false, tracking: 'unknown', lumens: null, memoryWarning: false,
};

export function chooseTier(c: ArCapabilities, k: ArConditions, p: ArPrefs): TierChoice {
  const diorama = (reason: string): TierChoice => ({ tier: 'diorama', reason, features: OFF });
  if (!p.ar) return diorama('AR is off');
  if (c.camera === 'none') return diorama('No camera on this device');
  if (c.camera === 'denied') return diorama('Camera access is off for KIN');

  const hot = k.thermal === 'serious';
  const critical = k.thermal === 'critical';
  const lowBattery = k.battery !== null && k.battery < 0.1 && !k.charging;
  const light = k.lowPower || hot || lowBattery;
  const dark = k.lumens !== null && k.lumens < DARK_LUMENS;

  if (c.native && c.tracking) {
    if (c.lidar) {
      // Room mode: the player hid the camera, or it's too dark for video. LiDAR still meshes.
      if (!p.showCamera || dark) {
        if (critical) return diorama('Your phone is very warm, so KIN went home for now');
        return {
          tier: 'room',
          reason: !p.showCamera ? 'Camera image hidden: KIN in a miniature of your room' : 'Too dark for the camera: KIN in a miniature of your room',
          features: { ...OFF, planes: true, mesh: true, meshHz: hot || k.memoryWarning ? 0.2 : 1, depthHz: 0 },
        };
      }
      if (critical || lowBattery) {
        return { tier: 'camera', reason: critical ? 'Your phone is very warm: lighter AR' : 'Battery low: lighter AR', features: { ...OFF, video: true, planes: true } };
      }
      return {
        tier: 'full',
        reason: light ? (hot ? 'Your phone is warm: lighter LiDAR' : k.lowPower ? 'Low Power Mode: lighter LiDAR' : 'Battery low: lighter LiDAR') : 'Camera + LiDAR',
        features: {
          video: true, planes: true, mesh: true,
          sceneDepth: c.sceneDepth && !light && !k.memoryWarning,
          people: c.people,
          meshHz: k.memoryWarning ? 0 : light ? 0.25 : 0.5,
          depthHz: k.memoryWarning ? 0 : light ? 8 : 15,
        },
      };
    }
    // Camera-only ARKit.
    if (!p.showCamera) return diorama('Hiding the camera needs LiDAR: here is the habitat');
    if (critical) return diorama('Your phone is very warm, so KIN went home for now');
    const people = c.people && !light && !k.memoryWarning;
    return {
      tier: 'camera',
      reason: dark ? 'It is dark: KIN may lose its footing' : light ? 'Camera AR, lighter' : 'Camera AR',
      features: { ...OFF, video: true, planes: true, people, depthHz: people ? (light ? 8 : 15) : 0 },
    };
  }
  if (c.webxr && c.tracking) {
    if (!p.showCamera) return diorama('Hiding the camera needs LiDAR: here is the habitat');
    return { tier: 'camera', reason: 'Camera AR (WebXR)', features: { ...OFF, video: true, planes: true } };
  }
  if (c.gyro && p.showCamera) {
    return { tier: 'camera-view', reason: 'AR+ off: camera view without room tracking', features: { ...OFF, video: true } };
  }
  return diorama(p.showCamera ? 'This device can’t track the room' : 'Camera hidden: here is the habitat');
}

/** Tiers ordered from richest to plainest, for transitions and badges. */
export const TIER_ORDER = ['full', 'camera', 'room', 'camera-view', 'diorama'] as const;

/** Badge label for each tier. */
export const TIER_LABEL: Record<string, string> = {
  full: 'AR · LiDAR', camera: 'AR', room: 'Room', 'camera-view': 'Camera view', diorama: 'Home',
};

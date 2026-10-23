// Native capabilities as progressive enhancement. On the web every call is a silent no-op;
// in the iOS/iPadOS app they route to Capacitor plugins. Gameplay never depends on them.

import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform(); // 'ios' | 'web'

type Impact = 'light' | 'medium' | 'heavy';
let haptics: typeof import('@capacitor/haptics') | null = null;
let enabled = true;

export async function initNative() {
  if (!isNative) return;
  haptics = await import('@capacitor/haptics');
  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  await StatusBar.hide().catch(() => {});
}

export function setHaptics(on: boolean) {
  enabled = on;
}

export function tap(kind: Impact = 'light') {
  if (!haptics || !enabled) return;
  const { Haptics, ImpactStyle } = haptics;
  const style = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind];
  void Haptics.impact({ style }).catch(() => {});
}

// Marquee ads (mutaafaziz.com/ads), owner decision 2026-10-30. KIN is a kids app, so:
// - ads live only on this landing page (menu context), never in the creature's play area;
// - the native Capacitor build loads nothing (native AdMob is a later phase);
// - Marquee tags Google requests child-directed, runs kid-safe sponsors only, with no click-outs.
// The loader never throws or blocks; with no fill it hides the slot.

type Cap = { Capacitor?: { isNativePlatform?: () => boolean } };

export function isNative(w: Cap = window as unknown as Cap): boolean {
  try {
    return !!w.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export function loadAds(doc: Document = document): void {
  if (isNative() || doc.querySelector('script[src*="/ads/v1/ads.js"]')) return;
  const s = doc.createElement('script');
  s.async = true;
  s.src = '/ads/v1/ads.js'; // same origin: the Marquee Worker serves mutaafaziz.com/ads*
  s.dataset.app = 'kin';
  s.dataset.slots = 'about-footer:banner:menu';
  doc.head.appendChild(s);
}

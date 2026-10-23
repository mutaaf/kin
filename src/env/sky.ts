// The live sky: the diorama follows the player's real time of day, sun angle, temperature, wind
// and precipitation. Location is coarse by default (from the timezone, no permission prompt);
// precise location is opt-in and rounded to ~11 km before it leaves the device.
// Weather comes from Open-Meteo (free, keyless, CORS-enabled); offline uses the last reading.

import type { Weather } from '../core/brain';
import type { KV } from '../persistence/store';
import { sunPosition } from './sun';

export interface Sky extends Weather {
  lat: number;
  lon: number;
  place: string;
  windDir: number; // degrees, direction the wind comes FROM
  sunAz: number;
  code: number; // WMO weather code
  fetchedAt: number;
  source: 'live' | 'cached' | 'default' | 'override';
}

// Coarse timezone → representative city. Anything missing falls back to the UTC offset.
const TZ: Record<string, [number, number, string]> = {
  'America/Chicago': [32.78, -96.8, 'Dallas'],
  'America/New_York': [40.71, -74.0, 'New York'],
  'America/Denver': [39.74, -104.99, 'Denver'],
  'America/Phoenix': [33.45, -112.07, 'Phoenix'],
  'America/Los_Angeles': [34.05, -118.24, 'Los Angeles'],
  'America/Anchorage': [61.22, -149.9, 'Anchorage'],
  'Pacific/Honolulu': [21.31, -157.86, 'Honolulu'],
  'America/Toronto': [43.65, -79.38, 'Toronto'],
  'America/Vancouver': [49.28, -123.12, 'Vancouver'],
  'America/Mexico_City': [19.43, -99.13, 'Mexico City'],
  'America/Sao_Paulo': [-23.55, -46.63, 'São Paulo'],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38, 'Buenos Aires'],
  'Europe/London': [51.51, -0.13, 'London'],
  'Europe/Paris': [48.86, 2.35, 'Paris'],
  'Europe/Berlin': [52.52, 13.4, 'Berlin'],
  'Europe/Madrid': [40.42, -3.7, 'Madrid'],
  'Europe/Rome': [41.9, 12.5, 'Rome'],
  'Europe/Istanbul': [41.01, 28.98, 'Istanbul'],
  'Africa/Cairo': [30.04, 31.24, 'Cairo'],
  'Africa/Lagos': [6.52, 3.38, 'Lagos'],
  'Africa/Johannesburg': [-26.2, 28.05, 'Johannesburg'],
  'Asia/Dubai': [25.2, 55.27, 'Dubai'],
  'Asia/Karachi': [24.86, 67.0, 'Karachi'],
  'Asia/Kolkata': [28.61, 77.21, 'Delhi'],
  'Asia/Dhaka': [23.81, 90.41, 'Dhaka'],
  'Asia/Singapore': [1.35, 103.82, 'Singapore'],
  'Asia/Shanghai': [31.23, 121.47, 'Shanghai'],
  'Asia/Seoul': [37.57, 126.98, 'Seoul'],
  'Asia/Tokyo': [35.68, 139.69, 'Tokyo'],
  'Australia/Sydney': [-33.87, 151.21, 'Sydney'],
  'Pacific/Auckland': [-36.85, 174.76, 'Auckland'],
  'Asia/Riyadh': [24.71, 46.68, 'Riyadh'],
  'Asia/Jakarta': [-6.21, 106.85, 'Jakarta'],
};

export function coarseLocation(tz = Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMin = new Date().getTimezoneOffset()) {
  const hit = TZ[tz];
  if (hit) return { lat: hit[0], lon: hit[1], place: hit[2] };
  return { lat: 35, lon: Math.max(-180, Math.min(180, (-offsetMin / 60) * 15)), place: tz.split('/').pop()?.replace(/_/g, ' ') ?? 'Somewhere' };
}

const CACHE_KEY = 'kin:sky:v1';
const TTL = 15 * 60_000;

/** URL overrides for demos: ?wx=rain|snow|storm|wind|heat|cold|clear&hour=21 */
export function overrides(search: string): { wx: string | null; hour: number | null } {
  const q = new URLSearchParams(search);
  const h = q.get('hour');
  return { wx: q.get('wx'), hour: h !== null && h !== '' && Number.isFinite(+h) ? +h : null };
}

export function skyClock(hour: number | null, now = new Date()): Date {
  if (hour === null) return now;
  const d = new Date(now);
  d.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);
  return d;
}

function applyWx(s: Sky, wx: string): Sky {
  const base = { ...s, source: 'override' as const };
  switch (wx) {
    case 'rain': return { ...base, precipMm: 2.5, snow: false, cloud: 0.9, windKmh: 14, tempC: 14, code: 63 };
    case 'storm': return { ...base, precipMm: 8, snow: false, cloud: 1, windKmh: 48, tempC: 18, code: 95 };
    case 'snow': return { ...base, precipMm: 1.2, snow: true, cloud: 0.95, windKmh: 8, tempC: -3, code: 73 };
    case 'wind': return { ...base, precipMm: 0, snow: false, cloud: 0.3, windKmh: 42, tempC: 17, code: 2 };
    case 'heat': return { ...base, precipMm: 0, snow: false, cloud: 0.05, windKmh: 5, tempC: 37, code: 0 };
    case 'cold': return { ...base, precipMm: 0, snow: false, cloud: 0.2, windKmh: 10, tempC: -8, code: 1 };
    case 'clear': return { ...base, precipMm: 0, snow: false, cloud: 0.05, windKmh: 6, tempC: 22, code: 0 };
    default: return s;
  }
}

function defaultSky(loc: { lat: number; lon: number; place: string }): Sky {
  return { ...loc, tempC: 20, windKmh: 8, windDir: 200, precipMm: 0, snow: false, cloud: 0.3, sunElev: 30, sunAz: 180, code: 1, fetchedAt: 0, source: 'default' };
}

export async function precise(): Promise<{ lat: number; lon: number } | null> {
  if (!('geolocation' in navigator)) return null;
  return new Promise((res) =>
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: Math.round(p.coords.latitude * 10) / 10, lon: Math.round(p.coords.longitude * 10) / 10 }),
      () => res(null),
      { maximumAge: 3_600_000, timeout: 8000, enableHighAccuracy: false },
    ),
  );
}

/** Resolve the current sky. Never throws; always returns something renderable. */
export async function readSky(kv: KV, opts: { precise: boolean; search: string; fetcher?: typeof fetch }): Promise<Sky> {
  const ov = overrides(opts.search);
  let loc: { lat: number; lon: number; place: string } = coarseLocation();
  if (opts.precise) {
    const p = await precise();
    if (p) loc = { ...p, place: 'Here' };
  }
  const withSun = (s: Sky): Sky => {
    const sun = sunPosition(skyClock(ov.hour), s.lat, s.lon);
    const out = { ...s, sunElev: sun.elevation, sunAz: sun.azimuth };
    return ov.wx ? applyWx(out, ov.wx) : out;
  };

  let cached: Sky | null = null;
  try {
    cached = JSON.parse(kv.get(CACHE_KEY) ?? 'null') as Sky | null;
  } catch {
    cached = null;
  }
  const near = cached && Math.abs(cached.lat - loc.lat) < 0.5 && Math.abs(cached.lon - loc.lon) < 0.5;
  if (cached && near && Date.now() - cached.fetchedAt < TTL) return withSun({ ...cached, source: 'cached' });

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,precipitation,snowfall,wind_speed_10m,wind_direction_10m,cloud_cover,weather_code`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await (opts.fetcher ?? fetch)(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { current: Record<string, number> };
    const c = j.current;
    const sky: Sky = {
      ...loc,
      tempC: c.temperature_2m ?? 20,
      windKmh: c.wind_speed_10m ?? 0,
      windDir: c.wind_direction_10m ?? 0,
      precipMm: c.precipitation ?? 0,
      snow: (c.snowfall ?? 0) > 0,
      cloud: (c.cloud_cover ?? 0) / 100,
      code: c.weather_code ?? 0,
      sunElev: 0,
      sunAz: 180,
      fetchedAt: Date.now(),
      source: 'live',
    };
    kv.set(CACHE_KEY, JSON.stringify(sky));
    return withSun(sky);
  } catch {
    return withSun(cached ? { ...cached, source: 'cached' } : defaultSky(loc));
  }
}

const usUnits = () => /^en-US|^en-LR|^my/.test(navigator.language || '');

const WMO: [number, string][] = [
  [0, 'clear'], [1, 'mostly clear'], [2, 'partly cloudy'], [3, 'overcast'], [45, 'fog'], [48, 'fog'],
  [51, 'drizzle'], [53, 'drizzle'], [55, 'drizzle'], [61, 'light rain'], [63, 'rain'], [65, 'heavy rain'],
  [71, 'light snow'], [73, 'snow'], [75, 'heavy snow'], [80, 'showers'], [81, 'showers'], [82, 'downpour'],
  [85, 'snow showers'], [86, 'snow showers'], [95, 'thunderstorm'], [96, 'thunderstorm'], [99, 'thunderstorm'],
];

export function describe(s: Sky): string {
  const us = usUnits();
  const t = us ? `${Math.round(s.tempC * 1.8 + 32)}°` : `${Math.round(s.tempC)}°`;
  const cond = WMO.find(([c]) => c === s.code)?.[1] ?? (s.precipMm > 0 ? (s.snow ? 'snow' : 'rain') : 'clear');
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const wind = s.windKmh < 3 ? 'still air' : `wind ${Math.round(us ? s.windKmh * 0.621 : s.windKmh)} ${us ? 'mph' : 'km/h'} ${dirs[Math.round(s.windDir / 45) % 8]}`;
  const night = s.sunElev < -6 ? ' · night' : s.sunElev < 6 ? (new Date().getHours() < 12 ? ' · dawn' : ' · dusk') : '';
  return `${t} · ${cond} · ${wind}${night}`;
}

/** Short phrase a memory keeps ("it was raining in Dallas"). */
export function weatherWord(s: Sky): string {
  if (s.precipMm > 0.15) return s.snow ? 'snowy' : 'rainy';
  if (s.windKmh > 30) return 'windy';
  if (s.tempC > 31) return 'hot';
  if (s.tempC < 4) return 'cold';
  if (s.sunElev < -6) return 'starry';
  return s.cloud > 0.7 ? 'cloudy' : 'sunny';
}

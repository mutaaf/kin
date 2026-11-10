// The app version, baked in at build time from package.json (vite.config.ts `define`). The
// native build reads the same number that `npm run testflight` stamps as MARKETING_VERSION.
declare const __KIN_VERSION__: string;
export const APP_VERSION: string = typeof __KIN_VERSION__ === 'string' ? __KIN_VERSION__ : '0.0.0';

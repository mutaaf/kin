import type { CapacitorConfig } from '@capacitor/cli';

// One codebase, three surfaces: web/PWA, iPhone and iPad. The native shell bundles the web
// build (`npm run build:native`), so the app works fully offline from first launch.
const config: CapacitorConfig = {
  appId: 'com.mutaafaziz.kin',
  appName: 'KIN',
  webDir: 'native-dist',
  backgroundColor: '#0B0D12',
  ios: { contentInset: 'never', backgroundColor: '#0B0D12', scrollEnabled: false, limitsNavigationsToAppBoundDomains: false },
};

export default config;

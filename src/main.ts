import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import './ui/style.css';
import { startApp } from './app';
import { randomId } from './core/rng';

// Each window is a home ("slot", in ?k=). No account, no signup wall: open the URL and a KIN
// is there. A Web Lock makes sure one slot is open in at most one window, so "Duplicate tab"
// can never show the same creature twice.
async function boot() {
  const url = new URL(location.href);
  let slot = url.searchParams.get('k') ?? '';
  if (!/^[a-z0-9]{3,16}$/.test(slot)) {
    slot = 'home';
    url.searchParams.set('k', slot);
    history.replaceState(null, '', url);
  }
  if ('locks' in navigator) {
    const got = await new Promise<boolean>((resolve) => {
      void navigator.locks.request(`kin-slot-${slot}`, { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        // Hold the lock for the life of the page.
        return lock ? new Promise<void>(() => {}) : undefined;
      });
    });
    if (!got) {
      url.searchParams.set('k', randomId('h').slice(2, 10));
      location.replace(url);
      return;
    }
  }
  await startApp(slot);
}

void boot();

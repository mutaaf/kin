// The "What's new" modal: a bright aurora card over the garden, once per version (see decide.ts).
// Lazy chunk: imported only when it will show, so the art never weighs on a normal load.

import './whatsnew.css';
import { GO_LABEL, type ArtKey, type Destination, type Release } from './notes';
import worlds from './art/worlds.webp';
import toys from './art/toys.webp';
import persona from './art/persona.webp';
import tricks from './art/tricks.webp';

const ART: Record<ArtKey, string> = { worlds, toys, persona, tricks };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ModalOptions {
  reducedMotion: boolean;
  /** Called once, after the modal is gone. */
  onClose?: () => void;
  /** A callout's button was tapped: the modal is gone, open this feature. */
  onGo?: (d: Destination) => void;
}

export function showWhatsNew(r: Release, o: ModalOptions): () => void {
  const app = document.getElementById('app');
  const before = document.activeElement as HTMLElement | null;
  const root = document.createElement('div');
  root.className = 'wn-scrim' + (o.reducedMotion ? ' wn-still' : '');
  root.innerHTML = `
    <section class="wn" role="dialog" aria-modal="true" aria-labelledby="wn-h" aria-describedby="wn-dek" tabindex="-1">
      <div class="wn-aurora" aria-hidden="true"><i></i><i></i><i></i><b></b></div>
      <header class="wn-head">
        <p class="wn-kicker"><span class="wn-ver">KIN ${esc(r.version)}</span>${esc(r.kicker)}</p>
        <h2 id="wn-h">${esc(r.headline)}</h2>
        <p class="wn-dek" id="wn-dek">${esc(r.dek)}</p>
      </header>
      <ul class="wn-cards" aria-label="New in this version">
        ${r.callouts
          .map(
            (c, i) => `<li class="wn-card${c.go && o.onGo ? ' wn-has-go' : ''}" style="--i:${i}">
              <img src="${ART[c.art]}" alt="" width="240" height="200" decoding="async" />
              <h3>${esc(c.title)}</h3>
              <p>${esc(c.line)}</p>
              ${c.go && o.onGo ? `<button class="wn-to" type="button" data-go="${c.go}" aria-label="${esc(`${GO_LABEL[c.go]}: ${c.title}`)}">${esc(GO_LABEL[c.go])}<span aria-hidden="true">→</span></button>` : ''}
            </li>`,
          )
          .join('')}
      </ul>
      <details class="wn-more">
        <summary>All the notes</summary>
        <ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
      </details>
      <button class="wn-go" type="button">Let’s go</button>
    </section>`;

  const dialog = root.querySelector<HTMLElement>('.wn')!;
  const go = root.querySelector<HTMLButtonElement>('.wn-go')!;
  let closed = false;

  const focusables = () => [...dialog.querySelectorAll<HTMLElement>('summary, button, a[href]')].filter((e) => !e.hasAttribute('disabled'));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      // The HUD closes its sheet on Escape at window level; this one is ours.
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  // Keep focus inside while open (a click on the scrim or a stray focus elsewhere).
  const onFocus = (e: FocusEvent) => {
    if (!closed && !dialog.contains(e.target as Node)) dialog.focus();
  };

  function close(then?: () => void) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('focusin', onFocus);
    app?.removeAttribute('inert');
    app?.removeAttribute('aria-hidden');
    const done = () => {
      root.remove();
      before?.focus?.();
      o.onClose?.();
      then?.();
    };
    if (o.reducedMotion) return done();
    root.classList.add('wn-out');
    setTimeout(done, 260);
  }

  go.addEventListener('click', () => close());
  // A callout's button (the whole card is its tap target) closes the modal, then opens the feature.
  root.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      const d = b.dataset.go as Destination;
      close(() => o.onGo?.(d));
    }),
  );
  // Pointer events on the garden behind must not reach the creature while this is open.
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('focusin', onFocus);
  app?.setAttribute('inert', '');
  app?.setAttribute('aria-hidden', 'true');
  document.body.append(root);
  dialog.focus();
  return () => close();
}

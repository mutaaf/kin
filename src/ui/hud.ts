// The thin UI layer. Appears only when needed; every control is a real button with a label.
// Never uses alert/confirm/prompt (they block the render loop and break the illusion).

import type { KinRecord } from '../core/creature';
import { temperament } from '../core/genome';
import type { PeerInfo, VisitorSnapshot } from '../protocol/messages';
import type { Settings } from '../persistence/store';
import { sharedScreen } from '../render/choreo';

export const swatch = (hue: number, light = 70) =>
  `background: radial-gradient(circle at 35% 30%, hsl(${hue} 70% ${light + 12}%), hsl(${hue} 55% ${light - 8}%))`;

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Bindings {
  kin: () => KinRecord;
  settings: Settings;
  peers: () => PeerInfo[];
  canVisit: () => boolean;
  visit: (peer: string) => void;
  openFriendWindow: () => void;
  setSettings: (p: Partial<Settings>) => void;
  forgetMemories: () => void;
  release: () => void;
}

export class Hud {
  private b!: Bindings;
  private sheet: string | null = null;
  private toastTimer = 0;
  private hintTimer = 0;
  private confirmRelease = false;

  bind(b: Bindings) {
    this.b = b;
    for (const btn of $('rail').querySelectorAll<HTMLButtonElement>('button[data-sheet]')) {
      btn.addEventListener('click', () => {
        const s = btn.dataset.sheet!;
        if (this.sheet === s) this.closeSheet();
        else this.openSheet(s);
      });
    }
    addEventListener('keydown', (e) => e.key === 'Escape' && this.closeSheet());
  }

  who(k: KinRecord) {
    $('name').textContent = k.name;
    $('temper').textContent = temperament(k.traits);
    document.title = `${k.name} · KIN`;
  }

  skyLine(s: string) {
    $('skyline').textContent = s;
  }

  rail(on: boolean) {
    $('rail').classList.toggle('on', on);
  }

  status(text: string) {
    const el = $('status');
    if (text) el.textContent = text;
    el.classList.toggle('on', !!text);
  }

  hint(text: string, ms = 0) {
    const el = $('hint');
    clearTimeout(this.hintTimer);
    if (text) el.textContent = text;
    el.classList.toggle('on', !!text);
    if (text && ms) this.hintTimer = window.setTimeout(() => el.classList.remove('on'), ms);
  }

  toast(text: string, ms = 3200) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('on'), ms);
  }

  debug(text: string) {
    $('debug').textContent = text;
  }

  debugVisible(on: boolean) {
    $('debug').hidden = !on;
  }

  /** Incoming visit request (beat 1: the host decides). */
  prompt(v: VisitorSnapshot | null, temper = '', answer?: (yes: boolean) => void) {
    const el = $('prompt');
    if (!v) {
      el.hidden = true;
      return;
    }
    el.innerHTML = `
      <div class="head"><span class="swatch" style="${swatch(v.hue)}"></span>
        <div><div class="t">${esc(v.name)} wants to visit</div><div class="s">A ${esc(temper)} KIN from the next screen over</div></div></div>
      <div class="row"><button class="btn primary" data-a="yes">Let in</button><button class="btn" data-a="no">Not now</button></div>`;
    el.hidden = false;
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
      b.addEventListener('click', () => {
        el.hidden = true;
        answer?.(b.dataset.a === 'yes');
      }),
    );
    el.querySelector<HTMLButtonElement>('.primary')?.focus();
  }

  /** While my KIN is away: a postcard, never an empty home. */
  postcard(k: KinRecord | null, recall?: () => void) {
    const el = $('postcard');
    if (!k || k.placement.kind !== 'away') {
      el.hidden = true;
      return;
    }
    const p = k.placement;
    el.innerHTML = `
      <div class="head"><span class="stamp"><span class="swatch" style="${swatch(0, 80)};opacity:.0"></span>✶</span>
        <div><div class="t">${esc(k.name)} is visiting ${esc(p.hostName)}</div><div class="s" data-since>just now</div></div></div>
      <div class="row"><button class="btn primary">Call ${esc(k.name)} home</button></div>`;
    el.hidden = false;
    const since = el.querySelector('[data-since]')!;
    const tick = () => {
      if (el.hidden) return;
      const s = Math.round((Date.now() - p.since) / 1000);
      since.textContent = s < 5 ? 'just arrived' : s < 60 ? `${s}s on the other screen` : `${Math.floor(s / 60)} min on the other screen`;
      setTimeout(tick, 1000);
    };
    tick();
    el.querySelector('button')!.addEventListener('click', () => {
      el.querySelector('button')!.disabled = true;
      recall?.();
    });
  }

  /** Host-side chips for guests currently visiting, with a gentle "send home". */
  guestBar(list: { id: string; name: string; hue: number }[], sendHome: (id: string) => void) {
    let el = document.getElementById('guests');
    if (!list.length) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'guests';
      el.className = 'prompt';
      el.style.top = 'auto';
      el.style.bottom = 'calc(96px + env(safe-area-inset-bottom, 0px))';
      $('hud').append(el);
    }
    el.innerHTML = list
      .map((g) => `<div class="head" style="margin:0"><span class="swatch" style="${swatch(g.hue)}"></span><div style="flex:1"><div class="t">${esc(g.name)} is visiting</div></div><button class="btn" data-id="${esc(g.id)}">Send home</button></div>`)
      .join('');
    el.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => ((b.disabled = true), sendHome(b.dataset.id!))));
  }

  nameCard(suggested: string, done: (name: string) => void) {
    const el = $('prompt');
    el.innerHTML = `
      <div class="name-card"><div class="t">Say hello. What's their name?</div>
      <input maxlength="16" value="${esc(suggested)}" aria-label="Name" autocomplete="off" spellcheck="false" />
      <div class="row"><button class="btn primary">That's them</button></div></div>`;
    el.hidden = false;
    const input = el.querySelector('input')!;
    const finish = () => {
      el.hidden = true;
      done(input.value.trim().replace(/\s+/g, ' ').slice(0, 16));
    };
    el.querySelector('button')!.addEventListener('click', finish);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && finish());
  }

  closeSheet() {
    this.sheet = null;
    $('sheet').hidden = true;
    $('rail').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }

  openSheet(name: string) {
    this.sheet = name;
    this.confirmRelease = false;
    $('rail').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === name)));
    this.render();
    $('sheet').hidden = false;
  }

  refreshGather() {
    if (this.sheet === 'gather') this.render();
  }

  private render() {
    const el = $('sheet');
    const k = this.b.kin();
    if (this.sheet === 'gather') {
      const peers = this.b.peers();
      const canVisit = this.b.canVisit();
      const mine = peers[0]?.rect ?? null;
      void mine;
      el.innerHTML = `
        <h2>Gather</h2>
        <p class="sub">KIN on nearby screens. Put two windows side by side (or two phones edge to edge) and send ${esc(k.name)} across.</p>
        ${peers.length ? peers.map((p) => `
          <div class="peer"><span class="swatch" style="${swatch(p.hue)}"></span>
            <div class="meta"><div class="n">${esc(p.name)}</div><div class="d">${esc(p.temperament)} · ${p.open ? (sharedScreen(p.rect, p.rect) ? 'next window' : 'nearby') : 'away right now'}</div></div>
            <button class="btn primary" data-visit="${esc(p.peer)}" ${p.open && canVisit ? '' : 'disabled'}>Visit</button></div>`).join('')
          : `<p class="sub" style="margin:6px 0 2px">Nobody nearby yet.</p>`}
        <div class="row" style="margin-top:12px"><button class="btn" data-friend>Open a friend window</button></div>
        <div class="label">Who can visit ${esc(k.name)}</div>
        <div class="seg" role="group" aria-label="Who can visit">
          ${(['ask', 'auto', 'off'] as const).map((m) => `<button data-visits="${m}" aria-pressed="${this.b.settings.visits === m}">${{ ask: 'Ask me', auto: 'Anyone nearby', off: 'Nobody' }[m]}</button>`).join('')}
        </div>
        <p class="sub" style="margin-top:12px">Same device for now: phone-to-phone over Wi-Fi arrives next.</p>`;
      el.querySelectorAll<HTMLButtonElement>('[data-visit]').forEach((b) => b.addEventListener('click', () => this.b.visit(b.dataset.visit!)));
      el.querySelector('[data-friend]')!.addEventListener('click', () => this.b.openFriendWindow());
      el.querySelectorAll<HTMLButtonElement>('[data-visits]').forEach((b) =>
        b.addEventListener('click', () => {
          this.b.setSettings({ visits: b.dataset.visits as Settings['visits'] });
          this.render();
        }),
      );
    } else if (this.sheet === 'memories') {
      const ms = k.memories;
      const friends = Object.entries(k.friends).sort((a, b) => b[1].meets - a[1].meets);
      el.innerHTML = `
        <h2>${esc(k.name)}'s memories</h2>
        <p class="sub">Kept on this device only. Other KIN appear by name, never their owner.</p>
        ${friends.length ? `<div class="label">Friends</div><div class="row">${friends.map(([, f]) => `<span class="btn" style="display:inline-flex;gap:8px;align-items:center;cursor:default"><span class="swatch" style="${swatch(f.hue)};width:16px;height:16px"></span>${esc(f.name)} · ${f.meets}×</span>`).join('')}</div>` : ''}
        <div class="label">Moments</div>
        ${ms.length ? ms.map((m) => `
          <div class="mem"><span class="swatch" style="${m.other ? swatch(m.other.hue) : 'background:var(--mint)'};width:20px;height:20px"></span>
            <div class="meta"><div class="note">${esc(m.note)}</div><div class="d">${new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></div></div>`).join('')
          : `<p class="sub">Nothing yet. Memories come from visits.</p>`}
        ${ms.length ? `<div class="row" style="margin-top:10px"><button class="btn danger" data-forget>Forget all memories</button></div>` : ''}`;
      el.querySelector('[data-forget]')?.addEventListener('click', () => {
        this.b.forgetMemories();
        this.render();
      });
    } else if (this.sheet === 'settings') {
      const s = this.b.settings;
      const sw = (key: keyof Settings, label: string, sub: string) =>
        `<div class="toggle"><div>${label}<small>${sub}</small></div><button class="switch" role="switch" aria-label="${label}" aria-checked="${!!s[key]}" data-key="${key}"></button></div>`;
      el.innerHTML = `
        <h2>Settings</h2>
        ${sw('sound', 'Sound', 'Chirps, purrs and chimes')}
        ${sw('reducedMotion', 'Reduced motion', 'Fades instead of hops')}
        ${sw('preciseSky', 'Precise sky', 'Use your location (rounded to ~11 km) for weather. Off: your timezone’s city.')}
        ${sw('debug', 'Why did it do that?', 'Show the brain’s reasoning')}
        <div class="label">This KIN</div>
        <div class="row"><button class="btn danger" data-release>${this.confirmRelease ? `Tap again to release ${esc(k.name)}` : `Release ${esc(k.name)}`}</button></div>`;
      el.querySelectorAll<HTMLButtonElement>('.switch').forEach((b) =>
        b.addEventListener('click', () => {
          const key = b.dataset.key as keyof Settings;
          this.b.setSettings({ [key]: !s[key] } as Partial<Settings>);
          this.render();
        }),
      );
      el.querySelector('[data-release]')!.addEventListener('click', () => {
        if (this.confirmRelease) this.b.release();
        else {
          this.confirmRelease = true;
          this.render();
        }
      });
    }
  }
}

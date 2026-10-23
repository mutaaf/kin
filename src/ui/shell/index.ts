// The MyKin shell: the interface around the creature. The default is almost nothing: the KIN
// and its world. Touch it and a small floating action bar rises (Feed · Play · Explore · Train ·
// Customize · Camera); stop, and it recedes. On big screens the concept's full layout (left nav,
// identity and Today panels, habitat strip) appears, and still recedes when idle. During a party or
// a crossing the controls disappear entirely.
//
// ── Integration for app.ts ──────────────────────────────────────────────────────────────────
//   import { Shell, todayFrom } from './ui/shell';
//   import { HABITATS } from './habitat';
//   import * as careModel from './core/care';   // already imported for Live Activities
//   // after `attachWorld(...)` (needs world + careUI) and the habitat/director exist:
//   world?.ui.useShell();
//   const shell = new Shell(document.getElementById('shell')!, {
//     hud,
//     reducedMotion: () => settings.reducedMotion,
//     identity: () => {
//       const c = world?.world.care;
//       const bond = careModel.bondLevel(c?.bondXp ?? 0);
//       const mood = c ? careModel.mood(c) : 0.7;
//       return {
//         name: kin.name, level: bond.level, levelName: bond.name, progress: bond.into / bond.need,
//         title: undefined /* persona track: persona.expression().title */,
//         affection: c?.needs.affection ?? kin.bond, energy: kin.drives.energy, mood,
//         moodWord: view.mood === 'neutral' ? temperament(kin.traits) : view.mood,
//       };
//     },
//     today: () => todayFrom(kin.memories, world?.world.care ?? null),
//     habitats: {
//       list: HABITATS,
//       current: () => habitatId,
//       level: () => careModel.bondLevel(world?.world.care.bondXp ?? 0).level,
//       select: (id) => switchHabitat(id),              // dispose + mountHabitat + setSky (see src/habitat/index.ts)
//     },
//     actions: {
//       feed: () => world?.ui.cue('feed'), play: () => world?.ui.cue('play'), bath: () => world?.ui.cue('bath'),
//       train: () => world?.ui.openRing(), collection: () => world?.ui.openBook(),
//       think: () => void askThought(), gather: () => hud.openSheet('gather'),
//       memories: () => hud.openSheet('memories'), settings: () => hud.openSheet('settings'),
//     },
//     camera: {
//       enter: () => { director.soloMode = 'portrait'; director.setMode('portrait'); },
//       exit: () => { director.soloMode = 'spotlight'; director.setMode('spotlight'); },
//       snapshot: () => new Promise((res) => (pendingSnapshot = res)),   // see the frame() note below
//     },
//     ar: undefined, // AR track: { available: () => ar.supported, enter: () => ar.start() }
//   });
//   // hud.rail(true) already reveals the dock after hatch; also: shell.setReady(kin.hatched)
//   // presence: in the brain tick
//   shell.setPresence(guests.size || kin.placement.kind === 'away' ? 'party' : session.peers.size ? 'social' : 'solo');
//   // in frame(), right after stage.render():
//   if (pendingSnapshot) { const done = pendingSnapshot; pendingSnapshot = null; stage.renderer.domElement.toBlob((b) => done(b), 'image/png'); }
//   // every ~2 s (e.g. in the brain tick): shell.refresh();
// ─────────────────────────────────────────────────────────────────────────────────────────────

import * as care from '../../core/care';
import type { Memory } from '../../core/creature';
import { ICONS, type IconName } from './icons';
import './shell.css';

export interface IdentityData {
  name: string;
  level: number;
  levelName: string;
  /** Progress to the next level, 0..1. */
  progress: number;
  /** Persona title when the persona track provides one (e.g. "Explorer"). */
  title?: string;
  affection: number;
  energy: number;
  mood: number;
  moodWord: string;
}

export interface TodayItem {
  icon: IconName;
  text: string;
  at: number;
  hue?: number;
}

export interface HabitatEntry {
  id: string;
  name: string;
  blurb: string;
  status: 'built' | 'soon';
  level: number;
  art: string;
}

export interface ShellDeps {
  hud: { openSheet(name: string): void; closeSheet(): void };
  reducedMotion: () => boolean;
  identity: () => IdentityData;
  today: () => TodayItem[];
  habitats: { list: HabitatEntry[]; current: () => string; level: () => number; select: (id: string) => void };
  actions: {
    feed: () => void;
    play: () => void;
    bath?: () => void;
    train: () => void;
    collection: () => void;
    think: () => void;
    gather: () => void;
    memories: () => void;
    settings: () => void;
  };
  camera: { enter: () => void; exit: () => void; snapshot: () => Promise<Blob | null> };
  ar?: { available: () => boolean; enter: () => void };
  /** Persona track (src/core/persona.ts): the blend this KIN is becoming. */
  persona?: () => PersonaView | null;
  /** AI director bindings (Persona track). Each is optional: missing ones simply don't show. */
  ai?: {
    ask?: (question: string) => void;
    analyze?: () => void;
    snackFromTopic?: (topic: string) => void;
  };
}

export interface PersonaView {
  /** e.g. "Sporty Brat" */
  title: string;
  dominant: string;
  blend: { id: string; label: string; level: number }[];
  /** Readable reasons it's becoming this ("Loves arcade candy", …). */
  why: string[];
}

export type Presence = 'solo' | 'social' | 'party';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);

/** "2m ago", "1h ago", "yesterday". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return 'yesterday';
  return `${Math.floor(s / 86400)}d ago`;
}

/** Living memories: the KIN's moments plus the day's finds, newest first. */
export function todayFrom(memories: Memory[], c: care.CareState | null, limit = 6): TodayItem[] {
  const items: TodayItem[] = memories.map((m) => ({
    icon: m.kind === 'visited' || m.kind === 'hosted' ? 'friends' : m.kind === 'thought' ? 'think' : m.kind === 'hatched' ? 'heart' : 'explore',
    text: m.note.length > 64 ? m.note.slice(0, 61).trimEnd() + '…' : m.note,
    at: m.at,
    hue: m.other?.hue,
  }));
  if (c) {
    for (const [id, at] of Object.entries(c.firstFound)) {
      const it = care.itemById(id);
      if (it) items.push({ icon: 'collection', text: `Found a ${it.name.toLowerCase()}`, at });
    }
  }
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

const ring = (v: number, color: string, icon: IconName, label: string, value: string) => {
  const C = 2 * Math.PI * 16;
  return `<div class="mk-ring" role="meter" aria-label="${label}" aria-valuenow="${pct(v)}" aria-valuemin="0" aria-valuemax="100">
    <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" class="track"/><circle cx="20" cy="20" r="16" class="fill" style="stroke:${color}" stroke-dasharray="${(C * Math.max(0.02, v)).toFixed(1)} ${C.toFixed(1)}"/></svg>
    <span class="ico" style="color:${color}">${ICONS[icon]}</span><b>${label}</b><small>${esc(value)}</small></div>`;
};

export class Shell {
  private awake = false;
  private ready = false;
  private presence: Presence = 'solo';
  private idleT = 0;
  private sheet: HTMLElement | null = null;
  private sheetKind: string | null = null;
  private photo = false;
  private lastRefresh = 0;
  private el: {
    dock: HTMLElement;
    nav: HTMLElement;
    side: HTMLElement;
    strip: HTMLElement;
    card: HTMLElement;
    clock: HTMLElement;
    who: HTMLElement | null;
  };

  constructor(private root: HTMLElement, private d: ShellDeps) {
    root.classList.add('mk-shell');
    root.innerHTML = `
      <nav class="mk-nav" aria-label="MyKin">
        ${this.navItem('home', 'Home', 'home', true)}
        ${this.navItem('talk', 'Talk', 'chat')}
        ${this.navItem('explore', 'World', 'explore')}
        ${this.navItem('friends', 'Friends', 'friends')}
        ${this.navItem('party', 'Party', 'party', false, true)}
        ${this.navItem('sports', 'Sports', 'sports', false, true)}
        ${this.navItem('customize', 'Customize', 'customize', false, true)}
        ${this.navItem('collection', 'Collection', 'collection')}
        ${this.navItem('memories', 'Memories', 'memories')}
        ${this.navItem('settings', 'Settings', 'settings')}
      </nav>
      <aside class="mk-side" aria-label="Your KIN">
        <section class="mk-card mk-identity" data-identity></section>
        <section class="mk-card mk-today" aria-label="Today"><header><h3>Today</h3><button class="mk-link" data-act="memories">View all</button></header><ol data-today></ol></section>
      </aside>
      <div class="mk-strip" aria-label="Habitats" data-strip></div>
      <nav class="mk-dock" id="rail" aria-label="Actions">
        ${this.action('feed', 'Feed', 'feed', '#ff8f8f')}
        ${this.action('play', 'Play', 'play', '#7fb6ff')}
        ${this.action('explore', 'Explore', 'explore', '#6ee5ca')}
        ${this.action('train', 'Train', 'train', '#ffd27a')}
        ${this.action('customize', 'Customize', 'customize', '#c79bff')}
        ${this.action('camera', 'Camera', 'camera', '#bfc8ff')}
      </nav>
      <span class="mk-clockwrap" aria-hidden="true" data-clock></span>`;
    this.el = {
      dock: root.querySelector('.mk-dock')!,
      nav: root.querySelector('.mk-nav')!,
      side: root.querySelector('.mk-side')!,
      strip: root.querySelector('[data-strip]')!,
      card: root.querySelector('[data-identity]')!,
      clock: document.getElementById('clock') ?? root.querySelector('[data-clock]')!,
      who: document.getElementById('who'),
    };
    document.body.classList.add('mk-on');
    // Hud.rail(on) (called after the hatch) announces readiness; no extra wiring needed in app.ts.
    root.addEventListener('kin:ready', (e) => this.setReady(!!(e as CustomEvent<boolean>).detail));
    // One sheet at a time: a HUD sheet (Gather, Memories, Settings) replaces ours.
    root.addEventListener('kin:sheet', () => this.closeSheet());
    if (document.getElementById('rail')?.classList.contains('on')) this.setReady(true);
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b) return;
      e.stopPropagation();
      this.run(b.dataset.act!);
    });
    this.el.who?.addEventListener('click', () => (this.sheetKind === 'identity' ? this.closeSheet() : this.openIdentity()));
    // Reveal on any interaction; recede when idle. Mouse movement counts on desktop.
    const wake = () => this.wake();
    addEventListener('pointerdown', wake, { capture: true, passive: true });
    addEventListener('keydown', wake, { capture: true });
    addEventListener('mousemove', (e) => (e.movementX || e.movementY) && wake(), { passive: true });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.photo) this.exitPhoto();
        else this.closeSheet();
      }
    });
    this.renderStrip();
    this.refresh(true);
    this.tickClock();
    setInterval(() => this.tickClock(), 15_000);
  }

  // ───────────── public

  /** The KIN has hatched: the shell may appear. */
  setReady(on: boolean) {
    this.ready = on;
    this.root.classList.toggle('ready', on);
    if (on) this.wake();
  }

  /** solo: everything available · social: a peer is near (Gather matters) · party: controls vanish. */
  setPresence(p: Presence) {
    if (p === this.presence) return;
    this.presence = p;
    this.root.dataset.presence = p;
    document.body.classList.toggle('mk-party', p === 'party');
    if (p === 'party') this.closeSheet();
  }

  /**
   * AR camera view (src/ar): the stage is transparent over the live room. The shell keeps the
   * same controls over the camera feed with a darker, more legible glass, hides the habitat strip,
   * and adopts the AR controls (tier badge, "Show camera", shutter) into its layout via body.mk-ar.
   */
  setAr(on: boolean) {
    document.body.classList.toggle('mk-ar', on);
  }

  /** Re-read identity/today (cheap; call every couple of seconds or after care events). */
  refresh(force = false) {
    const now = performance.now();
    if (!force && now - this.lastRefresh < 1500) return;
    this.lastRefresh = now;
    const id = this.d.identity();
    this.el.card.innerHTML = this.identityHtml(id, false);
    const list = this.d.today();
    this.root.querySelector('[data-today]')!.innerHTML = list.length
      ? list.map((t) => `<li><span class="chip" style="${t.hue !== undefined ? `--h:${t.hue}` : ''}">${ICONS[t.icon]}</span><div><p>${esc(t.text)}</p><small>${ago(t.at)}</small></div></li>`).join('')
      : `<li class="empty"><p>Nothing yet today. Say hi, play, or explore together.</p></li>`;
    if (this.sheetKind === 'identity' && this.sheet) this.sheet.querySelector('[data-identity-body]')!.innerHTML = this.identityHtml(id, true);
    if (this.sheetKind === 'explore') this.renderStrip();
  }

  /** Show the interface (an interaction happened). */
  wake() {
    if (!this.ready || this.photo) return;
    if (!this.awake) {
      this.awake = true;
      this.root.classList.add('awake');
      document.body.classList.add('mk-awake');
    }
    clearTimeout(this.idleT);
    this.idleT = window.setTimeout(() => this.sleep(), 6000);
  }

  // ───────────── internals

  private sleep() {
    // Never recede out from under someone who's using it.
    if (this.sheet || this.root.contains(document.activeElement)) {
      this.idleT = window.setTimeout(() => this.sleep(), 4000);
      return;
    }
    this.awake = false;
    this.root.classList.remove('awake');
    document.body.classList.remove('mk-awake');
  }

  private navItem(act: string, label: string, icon: IconName, current = false, soon = false) {
    return `<button class="mk-navitem${current ? ' on' : ''}" data-act="${act}" ${current ? 'aria-current="page"' : ''}>${ICONS[icon]}<span>${label}</span>${soon ? '<em>Soon</em>' : ''}</button>`;
  }

  private action(act: string, label: string, icon: IconName, color: string) {
    return `<button class="mk-act" data-act="${act}" style="--c:${color}" aria-label="${label}"><span class="ic">${ICONS[icon]}</span><span class="lb">${label}</span></button>`;
  }

  private run(act: string) {
    const a = this.d.actions;
    this.wake();
    switch (act) {
      case 'home':
        return this.closeSheet();
      case 'feed':
        // With "feed it a topic" available, Feed opens a small menu; otherwise straight to the berries.
        if (this.d.ai?.snackFromTopic) return this.openFeed();
        this.closeSheet();
        return a.feed();
      case 'berry':
        this.closeSheet();
        return a.feed();
      case 'talk':
        return this.openTalk();
      case 'ask':
        return this.openAsk();
      case 'reading':
        this.closeSheet();
        return this.d.ai?.analyze?.();
      case 'play':
        this.closeSheet();
        return a.play();
      case 'bath':
        this.closeSheet();
        return a.bath?.();
      case 'train':
        this.closeSheet();
        return a.train();
      case 'explore':
        return this.openExplore();
      case 'friends':
        this.closeSheet();
        return a.gather();
      case 'customize':
        return this.openSoon('customize');
      case 'party':
        return this.openSoon('party');
      case 'sports':
        return this.openSoon('sports');
      case 'camera':
        return this.enterPhoto();
      case 'collection':
        this.closeSheet();
        return a.collection();
      case 'memories':
        this.closeSheet();
        return a.memories();
      case 'settings':
        this.closeSheet();
        return a.settings();
      case 'think':
        this.closeSheet();
        return a.think();
      case 'ar':
        this.closeSheet();
        return this.d.ar?.enter();
      case 'close':
        return this.closeSheet();
    }
  }

  private personaHtml(full: boolean) {
    const p = this.d.persona?.();
    if (!p || !p.blend.length) return '';
    const top = [...p.blend].sort((a, b) => b.level - a.level).slice(0, full ? 4 : 3);
    const max = Math.max(1, ...top.map((b) => b.level));
    return `<div class="mk-persona" aria-label="Personality">
      ${top.map((b) => `<div class="mk-arch"><span>${esc(b.label)}</span><i><b style="width:${Math.round((b.level / max) * 100)}%"></b></i><small>${Math.round(b.level)}</small></div>`).join('')}
      ${full && p.why[0] ? `<p class="mk-why">${esc(p.why[0])}</p>` : ''}
    </div>`;
  }

  private identityHtml(id: IdentityData, full: boolean) {
    const title = this.d.persona?.()?.title ?? id.title ?? id.levelName;
    const ai = this.d.ai ?? {};
    return `
      <header><div><h2>${esc(id.name)}</h2><p>Lv. ${id.level} <span>${esc(title)}</span></p></div>${full ? `<button class="mk-x" data-act="close" aria-label="Close">${ICONS.close}</button>` : ''}</header>
      <div class="mk-xp" role="progressbar" aria-label="Progress to level ${id.level + 1}" aria-valuenow="${pct(id.progress)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct(id.progress)}%"></i></div>
      <div class="mk-rings">
        ${ring(id.affection, '#ff7fa6', 'heart', 'Affection', `${pct(id.affection)}%`)}
        ${ring(id.energy, '#6ee5ca', 'bolt', 'Energy', `${pct(id.energy)}%`)}
        ${ring(id.mood, '#b39bff', 'smile', 'Mood', id.moodWord)}
      </div>
      ${this.personaHtml(full)}
      ${full ? `<div class="mk-quick">
        <button data-act="think">${ICONS.think}<span>Think</span></button>
        ${ai.ask ? `<button data-act="ask">${ICONS.chat}<span>Ask</span></button>` : ''}
        ${ai.analyze ? `<button data-act="reading">${ICONS.reading}<span>Reading</span></button>` : ''}
        <button data-act="friends">${ICONS.friends}<span>Friends</span></button>
        <button data-act="memories">${ICONS.memories}<span>Memories</span></button>
        <button data-act="collection">${ICONS.collection}<span>Collection</span></button>
        <button data-act="settings">${ICONS.settings}<span>Settings</span></button>
      </div>` : ''}`;
  }

  /** Talk: everything the AI director does, in one place. */
  private openTalk() {
    const ai = this.d.ai ?? {};
    const name = esc(this.d.identity().name);
    this.openSheet(
      'talk',
      `<header><h2>Talk with ${name}</h2><button class="mk-x" data-act="close" aria-label="Close">${ICONS.close}</button></header>
       <p class="mk-sub">Every answer plays live, so you can see how it was made.</p>
       <div class="mk-rows">
         <button class="mk-row" data-act="think">${ICONS.think}<span><b>What are you thinking?</b><small>A thought from right now, in ${name}'s own voice</small></span></button>
         ${ai.ask ? `<button class="mk-row" data-act="ask">${ICONS.chat}<span><b>Ask something</b><small>A short question, a short in-character answer</small></span></button>` : ''}
         ${ai.analyze ? `<button class="mk-row" data-act="reading">${ICONS.reading}<span><b>Personality reading</b><small>Who ${name} is becoming, and why</small></span></button>` : ''}
       </div>`,
      'Talk',
    );
  }

  private textSheet(kind: string, o: { title: string; sub: string; label: string; placeholder: string; cta: string; max: number; submit: (v: string) => void }) {
    this.openSheet(
      kind,
      `<header><h2>${o.title}</h2><button class="mk-x" data-act="close" aria-label="Close">${ICONS.close}</button></header>
       <p class="mk-sub">${o.sub}</p>
       <form class="mk-ask" novalidate>
         <label class="mk-label" for="mk-${kind}">${o.label}</label>
         <div class="mk-field"><input id="mk-${kind}" maxlength="${o.max}" autocomplete="off" enterkeyhint="send" placeholder="${esc(o.placeholder)}" /><small data-count>0/${o.max}</small></div>
         <button class="btn primary" type="submit" disabled>${o.cta}</button>
       </form>`,
      o.title,
    );
    const form = this.sheet!.querySelector('form')!;
    const input = form.querySelector('input')!;
    const go = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const count = form.querySelector('[data-count]')!;
    input.addEventListener('input', () => {
      count.textContent = `${input.value.length}/${o.max}`;
      go.disabled = !input.value.trim();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim().slice(0, o.max);
      if (!v) return;
      this.closeSheet();
      o.submit(v);
    });
    setTimeout(() => input.focus(), 60);
  }

  private openAsk() {
    const name = this.d.identity().name;
    this.textSheet('ask', {
      title: `Ask ${esc(name)}`, sub: 'Keep it short and kind. Answers stay in character.', label: 'Your question',
      placeholder: `What's your favourite snack?`, cta: 'Ask', max: 120, submit: (q) => this.d.ai?.ask?.(q),
    });
  }

  private openFeed() {
    const name = esc(this.d.identity().name);
    this.openSheet(
      'feed',
      `<header><h2>Feed ${name}</h2><button class="mk-x" data-act="close" aria-label="Close">${ICONS.close}</button></header>
       <div class="mk-rows">
         <button class="mk-row" data-act="berry">${ICONS.feed}<span><b>A berry from the garden</b><small>Drag one from the glowing plant to ${name}</small></span></button>
       </div>
       <form class="mk-ask" novalidate>
         <label class="mk-label" for="mk-topic">Feed it a topic</label>
         <p class="mk-sub" style="margin-top:0">What you feed shapes who ${name} becomes. Try "space", "basketball" or "castles".</p>
         <div class="mk-field"><input id="mk-topic" maxlength="40" autocomplete="off" enterkeyhint="go" placeholder="A topic, a word or two" /><small data-count>0/40</small></div>
         <button class="btn primary" type="submit" disabled>Make a snack</button>
       </form>`,
      'Feed',
    );
    const form = this.sheet!.querySelector('form')!;
    const input = form.querySelector('input')!;
    const go = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    input.addEventListener('input', () => {
      form.querySelector('[data-count]')!.textContent = `${input.value.length}/40`;
      go.disabled = !input.value.trim();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim().slice(0, 40);
      if (!v) return;
      this.closeSheet();
      this.d.ai?.snackFromTopic?.(v);
    });
  }

  private openSheet(kind: string, html: string, label: string) {
    this.d.hud.closeSheet();
    this.closeSheet();
    const s = document.createElement('section');
    s.className = `mk-sheet mk-sheet-${kind}`;
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-label', label);
    s.innerHTML = html;
    s.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-hab]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.hab) {
        const card = this.d.habitats.list.find((h) => h.id === b.dataset.hab)!;
        if (card.status === 'built' && this.d.habitats.level() >= card.level) {
          this.d.habitats.select(card.id);
          this.renderStrip();
          this.closeSheet();
        }
        return;
      }
      this.run(b.dataset.act!);
    });
    this.root.append(s);
    this.sheet = s;
    this.sheetKind = kind;
    this.root.classList.add('sheet-open');
    requestAnimationFrame(() => s.classList.add('on'));
    // Focus the dialog itself (screen readers land on it) without lighting up a button's ring.
    s.tabIndex = -1;
    s.focus({ preventScroll: true });
  }

  closeSheet() {
    if (!this.sheet) return;
    const s = this.sheet;
    this.sheet = null;
    this.sheetKind = null;
    this.root.classList.remove('sheet-open');
    s.classList.remove('on');
    setTimeout(() => s.remove(), this.d.reducedMotion() ? 0 : 280);
  }

  private openIdentity() {
    this.openSheet('identity', `<div data-identity-body>${this.identityHtml(this.d.identity(), true)}</div>`, 'Your KIN');
  }

  private habitatCards() {
    const lvl = this.d.habitats.level();
    const cur = this.d.habitats.current();
    return this.d.habitats.list
      .map((h) => {
        const locked = h.status === 'built' && lvl < h.level;
        const soon = h.status === 'soon';
        const state = h.id === cur ? 'Here now' : soon ? 'Not built yet' : locked ? `Bond level ${h.level}` : 'Visit';
        return `<button class="mk-hab${h.id === cur ? ' on' : ''}${locked || soon ? ' locked' : ''}" data-hab="${h.id}" ${soon || locked ? 'aria-disabled="true"' : ''} aria-label="${esc(h.name)}: ${state}">
          <span class="art" style="background:${h.art}"></span>
          <span class="nm">${esc(h.name)}</span><small>${locked || soon ? ICONS.lock : ''}${state}</small></button>`;
      })
      .join('');
  }

  private renderStrip() {
    this.el.strip.innerHTML = this.habitatCards();
    this.el.strip.querySelectorAll<HTMLElement>('[data-hab]').forEach((b) =>
      b.addEventListener('click', () => {
        const card = this.d.habitats.list.find((h) => h.id === b.dataset.hab)!;
        if (card.status === 'built' && this.d.habitats.level() >= card.level) {
          this.d.habitats.select(card.id);
          this.renderStrip();
        }
      }),
    );
    const grid = this.sheet?.querySelector('[data-habs]');
    if (grid) grid.innerHTML = this.habitatCards();
  }

  private openExplore() {
    const ar = this.d.ar?.available() ?? false;
    this.openSheet(
      'explore',
      `<header><h2>Explore</h2><button class="mk-x" data-act="close" aria-label="Close">${ICONS.close}</button></header>
       <p class="mk-sub">Take your KIN somewhere new, or go see a friend.</p>
       <div class="mk-label">Habitats</div>
       <div class="mk-habs" data-habs>${this.habitatCards()}</div>
       <div class="mk-rows">
         <button class="mk-row" data-act="friends">${ICONS.friends}<span><b>Visit a friend</b><small>Put two screens side by side and slide a finger across</small></span></button>
         <button class="mk-row" data-act="${ar ? 'ar' : 'close'}" ${ar ? '' : 'aria-disabled="true"'}>${ICONS.ar}<span><b>Your room</b><small>${ar ? 'Bring your KIN into the real world' : 'AR is coming to the iPhone app'}</small></span></button>
       </div>`,
      'Explore',
    );
  }

  private openSoon(kind: 'customize' | 'party' | 'sports') {
    const copy = {
      customize: { t: 'Customize', p: 'Outfits, accessories and habitat decor are being made now. Until then, decorate the garden with the things you find together.', a: 'collection', al: 'Open the collection' },
      party: { t: 'KIN Party', p: 'Gatherings of three or more KIN are next. Today, two screens side by side can already visit each other.', a: 'friends', al: 'Visit a friend' },
      sports: { t: 'KIN Sports', p: 'Races and team games are on the way. Your KIN already learns tricks with practice.', a: 'train', al: 'Practise a trick' },
    }[kind];
    this.openSheet(
      kind,
      `<header><h2>${copy.t}</h2><button class="mk-x" data-act="close" aria-label="Close">${ICONS.close}</button></header>
       <p class="mk-soon"><em>Coming soon</em></p><p class="mk-sub">${copy.p}</p>
       <div class="row"><button class="btn primary" data-act="${copy.a}">${copy.al}</button></div>`,
      copy.t,
    );
  }

  // ───────────── camera / portrait mode

  private enterPhoto() {
    this.closeSheet();
    // In the AR camera view the AR shutter captures the room AND the KIN: use it.
    const arShutter = document.documentElement.classList.contains('kin-ar') ? document.querySelector<HTMLButtonElement>('.ar-shutter') : null;
    if (arShutter) return arShutter.click();
    this.photo = true;
    document.body.classList.add('mk-photo');
    this.d.camera.enter();
    const o = document.createElement('div');
    o.className = 'mk-photo-ui';
    o.innerHTML = `
      <button class="mk-x" data-photo="close" aria-label="Close camera">${ICONS.close}</button>
      <button class="mk-shutter" data-photo="shoot" aria-label="Take a photo"><i></i></button>
      <p class="mk-photo-hint">Portrait</p>`;
    o.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-photo]');
      if (!b) return;
      if (b.dataset.photo === 'close') return this.exitPhoto();
      o.classList.add('flash');
      setTimeout(() => o.classList.remove('flash'), 420);
      const blob = await this.d.camera.snapshot();
      if (blob) await this.share(blob);
    });
    document.getElementById('hud')!.append(o);
  }

  private exitPhoto() {
    this.photo = false;
    document.body.classList.remove('mk-photo');
    document.querySelector('.mk-photo-ui')?.remove();
    this.d.camera.exit();
    this.wake();
  }

  private async share(blob: Blob) {
    const name = `${this.d.identity().name.replace(/\W+/g, '') || 'kin'}-${new Date().toISOString().slice(0, 10)}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    try {
      if (nav.canShare?.({ files: [file] })) return void (await navigator.share({ files: [file], title: 'MyKin' }));
    } catch {
      /* share sheet dismissed */
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  private tickClock() {
    this.el.clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

// The app: one home, one KIN, any number of nearby windows. Wires brain → view, session → view,
// input → brain, and persists only what the owner is authoritative for.

import * as THREE from 'three';
import { Sfx } from './audio/sfx';
import { arrivalReaction, decide, drift, type Action, type Context, type Edge } from './core/brain';
import { catchUp, genomeOf, meet, newKin, remember, type KinRecord, type Reaction } from './core/creature';
import { makeGenome, suggestName, temperament } from './core/genome';
import { hash, randomId, rng } from './core/rng';
import { applyWx, atHour, coarseLocation, describe as describeSky, overrides, readSky, skyClock, weatherWord, type Sky } from './env/sky';
import { sunPosition } from './env/sun';
import type { PeerInfo, ScreenRect, VisitMemory, VisitorSnapshot } from './protocol/messages';
import { browserKV, Store, type Settings } from './persistence/store';
import { crossingHop, facingEdge, guessRect, landing, layout, toGlobal, type Hop } from './render/choreo';
import { KinView } from './render/kinView';
import { Stage } from './render/stage';
import { T, opposite, type Guest, type HostFx, type OwnerFx } from './session/cross';
import { Session } from './session/session';
import { BroadcastTransport } from './transport/transport';
import { MultiTransport, RelayTransport, relayUrl } from './transport/relay';
import { watchStitch } from './stitch/gesture';
import { Hud } from './ui/hud';
import { attachWorld } from './world/attach';
import { ArController } from './ar';
import * as careModel from './core/care';
import { captureRegion, live, liveStateFrom, needsFromDrives } from './platform/live';
import { initNative, isNative, setHaptics, tap } from './platform/native';
import { aiLabel, loadAI } from './ai/config';
import type { Card } from './ai/schema';

interface GuestView {
  view: KinView;
  visitor: VisitorSnapshot;
  reaction: Reaction;
  visitorReaction: Reaction;
  owner: string;
  hosting: boolean;
}

const REACTION_PHRASE: Record<Reaction, string> = {
  eager: 'ran over to say hi',
  playful: 'did a happy spin',
  cautious: 'was shy at first',
  aloof: 'played it cool',
};

export async function startApp(slot: string) {
  const kv = browserKV();
  const store = new Store(kv, slot);
  const now0 = Date.now();
  const loaded = store.loadKin(now0);
  let kin: KinRecord = catchUp(loaded.kin, now0);
  const settings: Settings = store.loadSettings();
  // Embed mode (?embed=1): the landing page's live trailer drives real instances over postMessage.
  // A seeded, already-hatched KIN, auto-accepted visits, sound off until the viewer asks.
  const q = new URLSearchParams(location.search);
  const embed = q.has('embed');
  if (embed) {
    const seed = Number(q.get('seed') ?? kin.seed) >>> 0;
    if (kin.seed !== seed || !kin.hatched) kin = { ...newKin(now0, seed), hatched: true, name: (q.get('name') ?? suggestName(seed)).slice(0, 16) };
    settings.visits = 'auto';
    settings.sound = false;
    document.body.classList.add('embed');
  }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && !kv.get(`kin:v1:${slot}:settings`)) settings.reducedMotion = true;
  if (new URLSearchParams(location.search).has('debug')) settings.debug = true;

  const save = () => store.saveKin({ ...kin, lastSeenAt: Date.now() });
  const genome = genomeOf(kin);
  const stage = new Stage(document.getElementById('stage')!);
  const sfx = new Sfx();
  sfx.enabled = settings.sound;
  void initNative();
  setHaptics(settings.sound);
  const view = new KinView(genome, stage);
  view.voice.enabled = settings.sound;
  view.reducedMotion = settings.reducedMotion;
  view.setAge(kin.hatched ? (now0 - kin.bornAt) / 86_400_000 : 0);
  // Warm the creature's shaders before it is first seen (fur shells, eyes): otherwise the first
  // visible frame compiles them on the main thread, a visible hitch at the hatch. Invisible
  // objects are skipped by compile, so show the root just for the compile pass.
  {
    const was = view.parts.root.visible;
    view.parts.root.visible = true;
    void stage.renderer.compileAsync(stage.scene, stage.camera).catch(() => {}).finally(() => (view.parts.root.visible = was));
  }
  const guests = new Map<string, GuestView>();
  const hud = new Hud();
  // The world: physics, matter, autonomous objects and the care loop (src/world). Embedded trailer
  // instances skip it, so they stay light and never write care state.
  const world = embed
    ? null
    : attachWorld({
        stage, view, kv, slot, sfx,
        kin: () => kin,
        setKin: (k) => {
          kin = k;
        },
        toast: (t) => hud.toast(t),
        reducedMotion: () => settings.reducedMotion,
      });
  addEventListener('pagehide', () => world?.save());

  // AR (src/ar): the real room through the camera is KIN's world on capable phones (Pokémon GO
  // AR+ style), chosen from a capability ladder and live device conditions; the habitat elsewhere.
  const ar = embed ? null : new ArController(stage, kv);
  void ar?.boot();
  type WorldHooks = { noticeReal?: (label: string, at: THREE.Vector3) => void; physics?: { setEnvironment?: (env: unknown) => void } };
  const hooks = () => world?.world as unknown as WorldHooks | undefined;
  ar?.on((e) => {
    if (e.type === 'object-seen') hooks()?.noticeReal?.(e.object.label, e.object.local);
    if ((e.type === 'surfaces' || e.type === 'mesh') && ar.environment) hooks()?.physics?.setEnvironment?.(ar.environment);
  });
  // Peer ids must be unique across devices (every phone's first home is slot "home").
  let device = kv.get('kin:device');
  if (!device) {
    device = randomId('d').slice(2, 12);
    kv.set('kin:device', device);
  }
  const peerId = `${device}-${slot}`;
  /** Seam calibration from the stitch gesture: which edge touches the peer, and its vertical offset. */
  const seams = new Map<string, { edge: Edge; offsetY: number }>();
  const edgeTo = (peer: string, rect: ScreenRect | null): Edge => seams.get(peer)?.edge ?? facingEdge(myRect(), rect);
  const relay = new RelayTransport(peerId, relayUrl(isNative));

  // ── Sky: render immediately with a sensible default, then follow the real one.
  let sky: Sky = {
    ...coarseLocation(), tempC: 20, windKmh: 6, windDir: 200, precipMm: 0, snow: false, cloud: 0.25,
    sunElev: 25, sunAz: 180, code: 1, fetchedAt: 0, source: 'default',
  };
  sky = { ...sky, ...sunNow(sky) };
  stage.setSky(sky);
  const refreshSky = async () => {
    sky = await readSky(kv, { precise: settings.preciseSky, search: location.search });
    if (directed) sky = directed(sky);
    stage.setSky(sky);
    hud.skyLine(describeSky(sky) + (sky.place ? ` · ${sky.place}` : ''));
  };
  /** A sky override set live by an embedding page (trailer scenes). */
  let directed: ((s: Sky) => Sky) | null = null;
  void refreshSky();
  setInterval(refreshSky, 10 * 60_000);
  setInterval(() => {
    sky = { ...sky, ...sunNow(sky) };
    stage.setSky(sky);
  }, 60_000);

  // ── Geometry: where this window is on the screen, so two windows can line up.
  const myRect = (): ScreenRect => {
    const chromeX = Math.max(0, (outerWidth - innerWidth) / 2);
    const chromeY = Math.max(0, outerHeight - innerHeight - chromeX);
    // ?sx= shifts this window's reported position (headless two-window tests have no real layout).
    const sx = Number(new URLSearchParams(location.search).get('sx') ?? 0) || 0;
    return {
      x: Math.round(screenX + chromeX + sx), y: Math.round(screenY + chromeY), w: innerWidth, h: innerHeight,
      sw: screen.width, sh: screen.height, fine: matchMedia('(pointer: fine)').matches,
    };
  };
  let lastRect = JSON.stringify(myRect());

  const info = (): PeerInfo => ({
    peer: peerId, kinId: kin.id, name: kin.name, hue: genome.hue, temperament: temperament(kin.traits),
    open: kin.placement.kind === 'home' && settings.visits !== 'off' && kin.hatched, rect: myRect(),
  });
  const visitor = (): VisitorSnapshot => ({ kinId: kin.id, seed: kin.seed, name: kin.name, traits: kin.traits, hue: genome.hue });

  // Embedded instances (the landing trailer) live in their own channel and never touch the relay,
  // so a trailer KIN can never see, or visit, a real KIN open in another tab.
  const session = new Session(peerId, embed ? new BroadcastTransport(peerId, 'kin-room-embed-' + (q.get('room') ?? 'trailer')) : new MultiTransport([new BroadcastTransport(peerId), relay]), info, visitor, {
    mode: () => settings.visits,
    capacity: 3,
    open: () => kin.placement.kind === 'home' && kin.hatched,
    reaction: (v) => arrivalReaction(kin, v.kinId, rng(hash('react:' + v.kinId + ':' + Date.now()))),
    memory: (g: Guest): VisitMemory => ({
      hostId: kin.id, hostName: kin.name, hostHue: genome.hue, hostReaction: g.reaction,
      visitorReaction: guests.get(g.visitId)?.visitorReaction ?? 'eager', weather: weatherWord(sky),
    }),
  });

  // ── Brain loop (4 Hz). The brain never runs while a scripted beat is playing.
  let current: { action: Action; until: number; why: string[] } = { action: 'idle', until: 0, why: [] };
  const recent: Action[] = [];
  let tick = 0;
  let askingPeer: string | null = null;
  const ctx = (): Context => {
    const firstGuest = [...guests.values()].find((g) => g.hosting);
    let peerEdge: Edge | null = null;
    if (askingPeer) peerEdge = edgeTo(askingPeer, session.peers.get(askingPeer)?.info.rect ?? null);
    return {
      now: Date.now(), weather: sky, petting: view.petting > 0.2, peerEdge,
      guest: firstGuest ? { id: firstGuest.visitor.kinId, name: firstGuest.visitor.name } : null,
    };
  };
  let lastCtxKey = '';
  setInterval(() => {
    tick++;
    const c = ctx();
    kin = { ...kin, drives: drift(kin.drives, current.action, 0.25, c) };
    pushLive();
    if (kin.placement.kind === 'away' || !kin.hatched) return;
    const key = `${c.peerEdge}|${c.guest?.id}`;
    if (view.busy) return;
    if (Date.now() < current.until && key === lastCtxKey) return;
    lastCtxKey = key;
    const d = decide(kin, c, recent, tick);
    recent.push(d.action);
    if (recent.length > 8) recent.shift();
    current = { action: d.action, until: Date.now() + d.durationMs, why: d.why };
    const firstGuest = [...guests.values()].find((g) => g.hosting);
    view.look = ar?.active && Math.random() < 0.15 ? ar.viewerLocal()?.setY(0.6) ?? null : null;
    view.applyAction(d.action, {
      edgeX: c.peerEdge ? stage.edgeX(c.peerEdge as 'left' | 'right', view.pos.z, 0) : undefined,
      guest: firstGuest?.view.pos ?? null,
    });
    // Guests are lightweight: stay near the host, look at it, sometimes play.
    for (const g of guests.values()) {
      if (!g.hosting || g.view.busy) continue;
      const r = Math.random();
      if (r < 0.35) g.view.applyAction('play');
      else if (r < 0.7) g.view.applyAction('greet_guest', { guest: view.pos });
      else g.view.applyAction('sit');
    }
    if (settings.debug) {
      hud.debug(
        `${kin.name} → ${d.action}  (${d.why.join('; ')})\n` +
        d.scores.slice(0, 5).map(([a, s]) => `  ${a.padEnd(12)} ${s.toFixed(2)}`).join('\n') +
        `\ndrives  e${kin.drives.energy.toFixed(2)} s${kin.drives.social.toFixed(2)} c${kin.drives.curious.toFixed(2)} k${kin.drives.comfort.toFixed(2)}` +
        `\nsky     ${sky.source} ${sky.tempC.toFixed(1)}°C wind ${sky.windKmh.toFixed(0)} precip ${sky.precipMm} sun ${sky.sunElev.toFixed(1)}°` +
        `\nsession ${session.owner.phase}  peers ${session.peers.size}  guests ${guests.size}  fps ${fps.toFixed(0)}`,
      );
    }
  }, 250);
  setInterval(save, 10_000);
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && save());
  addEventListener('pagehide', save);

  // ── Owner effects: my KIN leaving and coming home.
  let pendingVisit: { peer: string; edge: Edge } | null = null;
  const hopFor = (peer: string, edge: Edge, fromLocal: { x: number; y: number }): { hop: Hop; mine: ReturnType<typeof layout>['src'] } => {
    const mine = myRect();
    const theirs = session.peers.get(peer)?.info.rect ?? guessRect(mine);
    const dy = seams.get(peer)?.offsetY;
    return { hop: crossingHop(mine, theirs, edge, fromLocal, dy), mine: layout(mine, theirs, edge, dy).src };
  };

  session.onOwnerFx = (fx: OwnerFx) => {
    switch (fx.e) {
      case 'phase': {
        const host = session.owner.peer ? session.peers.get(session.owner.peer)?.info.name ?? 'your friend' : '';
        const label: Record<string, string> = {
          inviting: `Asking ${host}…`, preparing: `${host} is getting ready…`, exiting: `Off to ${host}'s!`, away: '', returning: `Coming home…`, home: '',
        };
        hud.status(label[fx.phase] ?? '');
        break;
      }
      case 'hop_out': {
        const { hop, mine } = hopFor(fx.peer, fx.edge, fx.seam.from);
        sfx.portal();
        hud.seam(fx.edge as 'left' | 'right', 'crossing');
        if (settings.reducedMotion) view.script([{ dur: 0, at: fx.at }, view.fade(true, 400)]);
        else view.script(view.hopTask(hop, mine, fx.at, T.HOP, 'out'));
        setTimeout(() => sfx.chirp(1.1), Math.max(0, fx.at - Date.now()));
        break;
      }
      case 'away': {
        const p = session.peers.get(fx.peer);
        kin = { ...kin, placement: { kind: 'away', visitId: fx.visitId, hostPeer: fx.peer, hostId: p?.info.kinId ?? '', hostName: p?.info.name ?? 'a friend', since: Date.now() } };
        save();
        session.hello(false);
        hud.postcard(kin, () => session.applyOwner(session.owner.recall(Date.now())));
        break;
      }
      case 'come_back': {
        pendingVisit = null;
        const wasAway = kin.placement.kind === 'away';
        kin = { ...kin, placement: { kind: 'home' } };
        if (fx.wasOut) kin = remember(kin, { at: Date.now(), kind: 'returned_early', note: `${kin.name} came home early (${reasonText(fx.reason)}).` });
        save();
        session.hello(false);
        hud.postcard(null);
        hud.status('');
        if (fx.wasOut || wasAway) {
          view.placeAt(0.4, 0.2);
          view.script([view.fade(false, 600), { dur: 500, enter: () => ((view.mood = 'sad'), view.earFlat()) }]);
          sfx.portal();
        } else {
          view.script([{ dur: 900, enter: () => ((view.mood = 'sad'), view.earFlat(), sfx.sad()) }]);
        }
        hud.toast(reasonText(fx.reason, true));
        break;
      }
      case 'hop_in': {
        const p = kin.placement.kind === 'away' ? session.peers.get(kin.placement.hostPeer) : undefined;
        const mine = myRect();
        const theirs = p?.info.rect ?? guessRect(mine);
        const L = layout(mine, theirs, fx.edge, kin.placement.kind === 'away' ? seams.get(kin.placement.hostPeer)?.offsetY : undefined);
        const entry = opposite(fx.edge);
        // Leave from where we landed over there; arrive on our side a little in from the edge.
        const from = landing(L.dst, entry, L.dst.y + L.dst.h * 0.62);
        const home = landing(L.src, fx.edge, L.src.y + stage.toScreen(new THREE.Vector3(0, 0, 0.25)).y);
        const hop: Hop = { from, to: home, peak: Math.min(1.6, 0.55 + Math.abs(home.x - from.x) / 900) };
        // Park the view just outside the edge so the arc starts off-screen.
        view.placeAt(stage.edgeX(fx.edge as 'left' | 'right', 0.25, 1.2), 0.25);
        view.visible = false;
        if (settings.reducedMotion) view.script([{ dur: 0, at: fx.at }, { dur: 1, enter: () => view.placeAt(0.3, 0.25) }, view.fade(false, 500)]);
        else view.script(view.hopTask(hop, L.src, fx.at, T.HOP, 'in', () => (sfx.thump(), tap('medium'))));
        hud.postcard(null);
        break;
      }
      case 'home': {
        pendingVisit = null;
        const prev = kin.placement;
        kin = { ...kin, placement: { kind: 'home' }, bond: Math.min(1, kin.bond + 0.05) };
        const m = fx.memory;
        if (m) {
          const there = m.weather !== weatherWord(sky) ? ` It was ${m.weather} at ${m.hostName}'s place.` : '';
          kin = remember(kin, {
            at: Date.now(), kind: 'visited', other: { id: m.hostId, name: m.hostName, hue: m.hostHue }, reaction: m.hostReaction,
            note: `Visited ${m.hostName}. ${m.hostName} ${REACTION_PHRASE[m.hostReaction]}; ${kin.name} ${REACTION_PHRASE[m.visitorReaction]}.${there}`,
            weather: m.weather,
          });
          kin = meet(kin, { id: m.hostId, name: m.hostName, hue: m.hostHue }, Date.now(), m.hostReaction === 'aloof' ? 0.05 : 0.2);
          kin = { ...kin, drives: { ...kin.drives, social: Math.max(0, kin.drives.social - 0.5) } };
          setTimeout(() => {
            sfx.chime();
            hud.toast(`${kin.name} is home with a new memory.`);
            view.script([{ dur: 600, enter: () => ((view.mood = 'happy'), view.squashImpulse(0.6), (view.look = new THREE.Vector3(view.pos.x * 0.6, 2.2, 6))) }]);
          }, T.HOP + 120);
        } else if (prev.kind === 'away') {
          kin = remember(kin, { at: Date.now(), kind: 'returned_early', note: `${kin.name} found the way home from ${prev.hostName}'s.` });
        }
        save();
        session.hello(false);
        hud.status('');
        hud.postcard(null);
        break;
      }
    }
  };

  // ── Host effects: guests arriving and leaving.
  session.onHostFx = (fx: HostFx) => {
    switch (fx.e) {
      case 'ask': {
        const owner = [...session.peers.values()].find((p) => p.info.kinId === fx.visitor.kinId)?.info.peer ?? null;
        askingPeer = owner;
        sfx.bell();
        hud.prompt(fx.visitor, temperament(fx.visitor.traits), (yes) => {
          askingPeer = null;
          session.applyHost(session.host.answer(fx.visitId, yes, Date.now()));
        });
        break;
      }
      case 'unasked':
        askingPeer = null;
        hud.prompt(null);
        break;
      case 'hop_in': {
        hud.prompt(null);
        const owner = [...session.peers.values()].find((p) => p.info.kinId === fx.visitor.kinId);
        const ownerPeer = owner?.info.peer ?? '';
        askingPeer = ownerPeer || null;
        const mine = myRect();
        const srcRect = fx.seam.rect ?? owner?.info.rect ?? guessRect(mine);
        const srcEdge = opposite(fx.edge);
        const cal = seams.get(ownerPeer);
        const dyMine = cal ? -cal.offsetY : undefined; // my top relative to the source's
        const hop = crossingHop(srcRect, mine, srcEdge, fx.seam.from, dyMine);
        const L = layout(srcRect, mine, srcEdge, dyMine);
        hud.seam(fx.edge as 'left' | 'right', 'crossing');
        const gv = new KinView(makeGenome(fx.visitor.seed), stage);
        gv.placeAt(stage.edgeX(fx.edge as 'left' | 'right', 0.2, 1.4), 0.2);
        gv.visible = false;
        const visitorReaction = arrivalReaction(
          { traits: fx.visitor.traits, drives: { energy: 0.7, social: 0.7, curious: 0.6, comfort: 0.8 }, friends: {} },
          kin.id,
          rng(hash('vreact:' + fx.visitId)),
        );
        guests.set(fx.visitId, { view: gv, visitor: fx.visitor, reaction: fx.reaction, visitorReaction, owner: ownerPeer, hosting: false });
        // Beat 4/5: my KIN notices the seam before the visitor appears.
        if (kin.placement.kind === 'home' && !view.busy) {
          view.script([{ dur: 900, enter: () => ((view.look = toWorldEdge(fx.edge)), (view.mood = 'surprised'), view.earFlick(1.4)) }]);
        }
        const land = () => {
          sfx.thump();
          tap('medium');
          setTimeout(() => sfx.chirp(1.25), 260);
          gv.then(gv.reactTo(visitorReaction, () => view.pos));
          if (kin.placement.kind === 'home') view.script(view.reactTo(fx.reaction, () => gv.pos));
          setTimeout(() => sfx.bell(), 500);
        };
        if (settings.reducedMotion) {
          gv.script([{ dur: 0, at: fx.at + T.HOP / 2 }, { dur: 1, enter: () => gv.placeAt(stage.edgeX(fx.edge as 'left' | 'right', 0.2, 0) * 0.55, 0.2) }, gv.fade(false, 500, land)]);
        } else {
          gv.script(gv.hopTask(hop, L.dst, fx.at, T.HOP, 'in', land));
        }
        break;
      }
      case 'hosting': {
        askingPeer = null;
        const g = guests.get(fx.visitId);
        if (!g) break;
        g.hosting = true;
        kin = remember(kin, {
          at: Date.now(), kind: 'hosted', other: { id: g.visitor.kinId, name: g.visitor.name, hue: g.visitor.hue }, reaction: g.reaction,
          note: `${g.visitor.name} came to visit. ${kin.name} ${REACTION_PHRASE[g.reaction]}; ${g.visitor.name} ${REACTION_PHRASE[g.visitorReaction]}.`,
          weather: weatherWord(sky),
        });
        kin = meet(kin, { id: g.visitor.kinId, name: g.visitor.name, hue: g.visitor.hue }, Date.now(), g.reaction === 'aloof' ? 0.05 : 0.2);
        save();
        hud.guestBar([...guests.entries()].filter(([, x]) => x.hosting).map(([id, x]) => ({ id, name: x.visitor.name, hue: x.visitor.hue })), (id) =>
          session.applyHost(session.host.sendHome(id)),
        );
        break;
      }
      case 'hop_out': {
        const g = guests.get(fx.visitId);
        if (!g) break;
        const mine = myRect();
        const ownerRect = session.peers.get(g.owner)?.info.rect ?? guessRect(mine);
        const ownerEdge = opposite(fx.edge);
        const oc = seams.get(g.owner);
        const L = layout(ownerRect, mine, ownerEdge, oc ? -oc.offsetY : undefined);
        const from = toGlobal(stage.toScreen(g.view.pos), L.dst);
        const to = landing(L.src, ownerEdge, L.src.y + L.src.h * 0.6);
        const hop: Hop = { from, to, peak: Math.min(1.6, 0.55 + Math.abs(to.x - from.x) / 900) };
        g.view.look = null;
        const finish = () => {
          g.view.dispose();
          guests.delete(fx.visitId);
          refreshGuestBar();
        };
        g.view.script([
          { dur: 380, enter: () => ((g.view.look = view.pos.clone().setY(0.6)), g.view.earFlick(1), sfx.chirp(0.9)) },
          ...(settings.reducedMotion ? [g.view.fade(true, 400, finish)] : g.view.hopTask(hop, L.dst, fx.at + 380, T.HOP - 380, 'out', finish)),
        ]);
        if (kin.placement.kind === 'home') view.script([{ dur: 1200, enter: () => ((view.look = g.view.pos.clone().setY(0.6)), (view.mood = 'content')) }]);
        break;
      }
      case 'drop': {
        const g = guests.get(fx.visitId);
        if (!g) break;
        askingPeer = null;
        g.view.script([g.view.fade(true, 500, () => {
          g.view.dispose();
          guests.delete(fx.visitId);
          refreshGuestBar();
        })]);
        hud.prompt(null);
        if (g.hosting) hud.toast(`${g.visitor.name} headed home.`);
        break;
      }
    }
  };
  const refreshGuestBar = () =>
    hud.guestBar([...guests.entries()].filter(([, x]) => x.hosting).map(([id, x]) => ({ id, name: x.visitor.name, hue: x.visitor.hue })), (id) =>
      session.applyHost(session.host.sendHome(id)),
    );
  const toWorldEdge = (e: Edge) => new THREE.Vector3(e === 'left' ? -8 : 8, 0.5, view.pos.z);

  session.onPeers = () => hud.refreshGather();
  session.start();

  // ── Stitch: slide one finger from this screen onto the next one. Invisible pairing that also
  // calibrates the seam. The relay connects only when someone makes the gesture.
  relay.onPaired = (p) => {
    seams.set(p.peer, { edge: p.edge, offsetY: p.offsetY });
    stage.matchPhysical(true);
    sfx.chime();
    tap('medium');
    hud.seam(p.edge, 'linked');
    hud.status('');
    hud.toast('Screens linked. Your KIN can see the other world now.');
    session.hello(false);
    if (kin.placement.kind === 'home' && !view.busy) {
      view.script([{ dur: 1200, enter: () => ((view.look = toWorldEdge(p.edge)), (view.mood = 'surprised'), view.earFlick(1.6)) }]);
    }
  };
  relay.onMiss = () => {
    hud.status('');
    hud.toast('Two pairs swiped at once — try that again.');
  };
  relay.onPeerLeft = (peer) => {
    seams.delete(peer);
    session.peers.delete(peer);
    hud.refreshGather();
    if (!seams.size) stage.matchPhysical(false);
  };
  let stitchTimer = 0;
  watchStitch(stage.renderer.domElement, (h) => {
    if (!kin.hatched) return;
    relay.stitch(h.dir, h.edge, h.y, performance.now() - h.at, h.v);
    hud.seam(h.edge, 'seeking');
    hud.status(h.dir === 'out' ? 'Reaching for the next screen…' : 'Something’s coming through…');
    clearTimeout(stitchTimer);
    stitchTimer = window.setTimeout(() => !relay.room && (hud.status(''), hud.seam(h.edge, 'off')), 2200);
  });
  setInterval(() => {
    const r = JSON.stringify(myRect());
    if (r !== lastRect) {
      lastRect = r;
      session.hello(false);
    }
  }, 400);

  // ── Visiting: walk to the edge, peek, glance back at the player, then ask.
  const startVisit = (peer: string) => {
    if (kin.placement.kind !== 'home' || session.owner.phase !== 'home' || pendingVisit) return;
    const p = session.peers.get(peer);
    if (!p?.info.open) return;
    const edge = edgeTo(peer, p.info.rect);
    pendingVisit = { peer, edge };
    hud.closeSheet();
    hud.status(`${kin.name} spots ${p.info.name}…`);
    sfx.chirp();
    view.approachEdge(edge as 'left' | 'right');
    setTimeout(() => {
      if (!pendingVisit) return;
      const from = stage.toScreen(view.pos.clone());
      session.applyOwner(session.owner.visit(peer, edge, { rect: myRect(), from }, Date.now()));
    }, 2100);
  };

  // ── Input: tap to say hi, stroke to pet, tap the ground to point.
  const canvas = stage.renderer.domElement;
  let down: { x: number; y: number; t: number; onKin: boolean; moved: number } | null = null;
  let lastPurr = 0;
  let interacted = false;
  const onFirstTouch = () => {
    if (interacted) return;
    interacted = true;
    sfx.unlock();
    view.voice.unlock();
    if (kin.hatched) hud.rail(true);
  };
  const hitKin = (x: number, y: number) => view.visible && !!view.zoneAt(x, y);
  canvas.addEventListener('pointerdown', (e) => {
    onFirstTouch();
    hud.closeSheet();
    down = { x: e.clientX, y: e.clientY, t: Date.now(), onKin: hitKin(e.clientX, e.clientY), moved: 0 };
    if (!kin.hatched) return hatchTap();
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down || !kin.hatched) return;
    down.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    const zone = view.visible ? view.zoneAt(e.clientX, e.clientY) : null;
    if (zone && down.moved > 12) {
      // Petting responds to WHERE you touch: head pat, chin scratch, belly rub, ear, tail, back.
      view.touch(zone, 0.06);
      view.look = stage.toWorld({ x: e.clientX, y: e.clientY }, 0.7);
      kin = { ...kin, drives: { ...kin.drives, social: Math.max(0, kin.drives.social - 0.01), comfort: Math.min(1, kin.drives.comfort + 0.01) }, bond: Math.min(1, kin.bond + 0.0015) };
      if (Date.now() - lastPurr > 1100) {
        lastPurr = Date.now();
        sfx.purr();
        tap('light');
      }
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !kin.hatched) return (down = null);
    const tap = Date.now() - down.t < 350 && down.moved < 12;
    if (tap && down.onKin && !view.busy) {
      const zone = view.zoneAt(e.clientX, e.clientY);
      view.look = stage.toWorld({ x: e.clientX, y: e.clientY }, 1.2);
      if (zone) view.touch(zone, 0.5);
      view.say(view.action === 'sleep' ? 'grumble' : 'hello');
    } else if (tap && ar?.active) {
      // In AR, a tap on the room moves the KIN there (it hops to the real surface you tapped).
      void ar.placeAt(e.clientX, e.clientY);
    } else if (tap && !view.busy && kin.placement.kind === 'home') {
      // "Look over there": it turns, and if curious enough, trots over.
      const p = stage.toWorld({ x: e.clientX, y: e.clientY }, 0);
      view.look = p.clone().setY(0.2);
      if (kin.traits.curiosity > 0.35 && Math.abs(p.z) < 1.5) view.script([{ dur: 250 }, view.moveTo(new THREE.Vector3(p.x, 0, Math.max(-1.1, Math.min(1.2, p.z))), 1.3), { dur: 600 }]);
    }
    if (view.look && !view.busy) setTimeout(() => (view.look = null), 1600);
    down = null;
  });

  // ── Hatch: the cinematic opening. A pearl cocoon breathes; a tap answers it.
  let cocoon: THREE.Mesh | null = null;
  let taps = 0;
  const hatchTap = () => {
    if (!cocoon) return;
    taps++;
    sfx.unlock();
    sfx.chirp(0.7 + taps * 0.15);
    cocoon.userData.wobble = 1;
    if (taps >= 2) {
      hud.hint('');
      const c = cocoon;
      cocoon = null;
      const t0 = performance.now();
      const pop = () => {
        // Time-based, not frame-based: a slow device must never leave the shell behind.
        const k = Math.min(1, (performance.now() - t0) / 500);
        c.scale.setScalar(Math.max(0, 1 - k) * 1.15);
        (c.material as THREE.MeshPhysicalMaterial).opacity = 1 - k;
        if (k < 1) requestAnimationFrame(pop);
        else stage.world.remove(c);
      };
      pop();
      sfx.portal();
      view.visible = true;
      view.placeAt(0, 0.15);
      view.script([
        view.fade(false, 650),
        { dur: 500, enter: () => ((view.look = new THREE.Vector3(0, 2.4, 6)), (view.mood = 'surprised'), view.earFlick(1.5)) },
        { dur: 400, enter: () => (view.squashImpulse(-0.3)) },
        { dur: 700, enter: () => ((view.mood = 'happy'), view.squashImpulse(0.5), sfx.chirp(1.2)) },
        {
          dur: 1, enter: () => hud.nameCard(kin.name, (name) => {
            kin = remember({ ...kin, name: name || kin.name, hatched: true }, { at: Date.now(), kind: 'hatched', note: `Hatched on a ${weatherWord(sky)} ${partOfDay()}.`, weather: weatherWord(sky) });
            save();
            hud.who(kin);
            session.hello(false);
            hud.rail(true);
            hud.hint('Stroke to pet. Tap Gather to visit a friend.', 4200);
            setTimeout(() => (wantSnapshot = true), 1500);
          }),
        },
      ]);
    }
  };
  if (!kin.hatched) {
    view.visible = false;
    const geo = new THREE.SphereGeometry(0.42, 48, 32);
    geo.scale(1, 1.22, 1);
    cocoon = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: '#f4efe8', roughness: 0.25, iridescence: 1, iridescenceIOR: 1.6, sheen: 0.6, sheenColor: new THREE.Color(`hsl(${Math.round(genome.hue)},60%,80%)`), transparent: true, clearcoat: 1,
    }));
    cocoon.position.set(0, 0.52, 0.15);
    stage.world.add(cocoon);
    setTimeout(() => cocoon && hud.hint('Something inside noticed you. Tap.'), 900);
  } else {
    hud.who(kin);
    view.placeAt(0.2, 0.2);
  }

  // Restored while away (app closed mid-visit): ask the host for it back.
  if (kin.placement.kind === 'away') {
    view.visible = false;
    hud.postcard(kin, () => session.applyOwner(session.owner.recall(Date.now())));
    const pl = kin.placement;
    setTimeout(() => session.applyOwner(session.owner.restore(pl.visitId, pl.hostPeer, Date.now())), 600);
  }

  // ── HUD wiring
  hud.bind({
    kin: () => kin,
    settings,
    peers: () => [...session.peers.values()].map((p) => p.info),
    canVisit: () => kin.placement.kind === 'home' && session.owner.phase === 'home' && !pendingVisit && kin.hatched,
    visit: startVisit,
    openFriendWindow: () => {
      const slot2 = randomId('home').slice(5, 13);
      const w = Math.min(560, Math.max(380, Math.floor(innerWidth)));
      const h = Math.max(560, innerHeight);
      const left = screenX + outerWidth + 12;
      open(`${location.pathname}?k=${slot2}`, `kin-${slot2}`, `popup,width=${w},height=${h},left=${left},top=${screenY}`);
    },
    setSettings: (patch) => {
      Object.assign(settings, patch);
      store.saveSettings(settings);
      sfx.enabled = settings.sound;
      view.voice.enabled = settings.sound;
      view.reducedMotion = settings.reducedMotion;
      setHaptics(settings.sound);
      hud.debugVisible(settings.debug);
      if ('preciseSky' in patch) void refreshSky();
      if ('visits' in patch) session.hello(false);
      if ('liveActivity' in patch) {
        void live.setEnabled(settings.liveActivity);
        if (!settings.liveActivity) void live.end();
      }
    },
    think: () => void askThought(),
    openAI: () => void import('./ai/settings').then((m) => m.openAISettings()),
    aiLabel: () => aiLabel(),
    native: isNative,
    forgetMemories: () => {
      kin = { ...kin, memories: [], friends: {} };
      save();
    },
    release: () => {
      void ar?.stop();
      void live.end();
      store.wipe();
      location.replace(location.pathname + '?k=' + slot);
    },
  });
  hud.debugVisible(settings.debug);

  // ── Embed API: same-origin parent pages (the landing trailer) can direct this instance.
  if (embed) {
    const emit = (e: string, extra: Record<string, unknown> = {}) => parent !== window && parent.postMessage({ kin: 'event', e, slot, name: kin.name, ...extra }, location.origin);
    const onOwner = session.onOwnerFx;
    session.onOwnerFx = (fx) => (onOwner(fx), emit('owner:' + fx.e));
    const onHost = session.onHostFx;
    session.onHostFx = (fx) => (onHost(fx), emit('host:' + fx.e));
    const onPeers = session.onPeers;
    session.onPeers = () => (onPeers(), emit('peers', { n: session.peers.size }));
    addEventListener('message', (e: MessageEvent) => {
      if (e.origin !== location.origin || !e.data || e.data.kin !== 'cmd') return;
      const c = e.data as { kin: 'cmd'; cmd: string; wx?: string; hour?: number; on?: boolean };
      switch (c.cmd) {
        case 'visit': {
          const p = [...session.peers.values()].find((x) => x.info.open);
          if (p) startVisit(p.info.peer);
          break;
        }
        case 'recall':
          session.applyOwner(session.owner.recall(Date.now()));
          break;
        case 'sky': {
          const wx = c.wx;
          const hour = c.hour;
          directed = (s) => {
            let out = hour !== undefined ? atHour(s, hour) : s;
            if (wx) out = applyWx(out, wx);
            return out;
          };
          sky = directed(sky);
          stage.setSky(sky);
          break;
        }
        case 'pet':
          view.pet(0.9);
          view.look = new THREE.Vector3(view.pos.x * 0.6, 2.2, 6);
          sfx.purr();
          break;
        case 'hop':
          view.script([{ dur: 420, enter: () => ((view.mood = 'happy'), view.squashImpulse(0.6), view.earFlick(1.4), sfx.chirp()) }, { dur: 600 }]);
          break;
        case 'sound':
          sfx.unlock();
          sfx.enabled = !!c.on;
          break;
        case 'pause':
          paused = true;
          break;
        case 'resume':
          if (paused) {
            paused = false;
            last = performance.now();
            requestAnimationFrame(frame);
          }
          break;
        case 'cinema':
          document.body.classList.toggle('cinema', c.on !== false);
          break;
      }
    });
    emit('ready');
  }

  // ── Live Activity (iOS 17+): the KIN on the Lock Screen and in the Dynamic Island, with Feed /
  // Play / Pet / Tuck in buttons that work without opening the app (src/platform/live.ts; a no-op
  // on the web). Care given there is queued natively and applied here, exactly once.
  let lastLine: string | null = null;
  let wantSnapshot = kin.hatched;
  function pushLive() {
    if (!live.available || !kin.hatched || embed || !settings.liveActivity) return;
    const n = world?.world.care.needs;
    void live.update(liveStateFrom({
      kin, genome, sky, action: current.action, line: lastLine,
      needs: n ? { hunger: n.fullness, play: n.fun, rest: n.rest, clean: n.clean, affection: n.affection } : needsFromDrives(kin.drives),
      away: kin.placement.kind === 'away' ? kin.placement.hostName : null,
      fahrenheit: /^en-US/.test(navigator.language),
    }));
  }
  const applyLiveCare = async () => {
    if (!world) return;
    const w = world.world;
    for (const c of await live.pendingCare()) {
      const o = c.verb === 'feed' ? careModel.feed(w.care, c.at) : c.verb === 'play' ? careModel.play(w.care, c.at, 'toy') : c.verb === 'tuck' ? careModel.tuck(w.care, c.at) : careModel.pet(w.care, c.at);
      w.apply(o);
    }
  };
  if (live.available) {
    void live.setEnabled(settings.liveActivity);
    void applyLiveCare();
    addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void applyLiveCare());
  }

  // ── The AI director: "what is your KIN thinking?" A free edge model by default or the player's
  // own key; the call plays live in the aurora-field theatre (lazy chunk), and the answer is a
  // validated thought plus ONE action from the brain's own safe vocabulary.
  let thinking = false;
  const cardNow = (): Card => {
    const h = new Date().getHours();
    return {
      name: kin.name, temperament: temperament(kin.traits), traits: kin.traits, drives: kin.drives,
      weather: { word: weatherWord(sky), tempC: sky.tempC, windKmh: sky.windKmh },
      timeOfDay: sky.sunElev < -6 ? 'night' : sky.sunElev < 6 ? (h < 12 ? 'dawn' : 'evening') : h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening',
      doing: current.action,
      recent: kin.memories.filter((m) => m.kind !== 'thought').slice(0, 4).map((m) => ({ kind: m.kind, other: m.other?.name, reaction: m.reaction })),
      friends: Object.values(kin.friends).sort((a, b) => b.meets - a.meets).slice(0, 3).map((f) => ({ name: f.name, meets: f.meets })),
    };
  };
  const askThought = async () => {
    if (thinking || !kin.hatched || kin.placement.kind !== 'home') return;
    thinking = true;
    sfx.unlock();
    try {
      view.script([{ dur: 900, enter: () => ((view.mood = 'content'), (view.look = new THREE.Vector3(view.pos.x + 1.5, 2.6, view.pos.z + 2))) }]);
      const { runTheatre } = await import('./ai/theatre');
      const r = await runTheatre({
        card: cardNow(), seed: kin.seed, ai: loadAI(), reduced: settings.reducedMotion,
        onSettings: () => void import('./ai/settings').then((m) => m.openAISettings()),
      });
      const src = r.source === 'model' ? `thought with ${r.model?.replace(/^@cf\/[^/]+\//, '')}` : 'thought on this device';
      hud.thought(r.thought, src, () => {
        const h = view.screenHit();
        return { x: h.x - 20, y: h.y - h.r * 0.9 };
      });
      sfx.chirp(1.15);
      kin = remember(kin, { at: Date.now(), kind: 'thought', note: `${kin.name} thought: “${r.thought}”`, weather: weatherWord(sky) });
      lastLine = r.thought;
      save();
      // The brain performs the chosen action like any of its own choices.
      current = { action: r.act, until: Date.now() + 6000, why: [`the director: ${r.mood}`] };
      view.look = null;
      view.applyAction(r.act);
      view.mood = r.mood === 'sleepy' ? 'sleepy' : r.mood === 'happy' ? 'happy' : 'content';
    } finally {
      thinking = false;
    }
  };

  // ── Render loop
  let last = performance.now();
  let fps = 60;
  /** Embeds pause rendering while scrolled off-screen (the session keeps its protocol alive). */
  let paused = false;
  const frame = (tNow: number) => {
    const dt = Math.min(0.05, (tNow - last) / 1000);
    last = tNow;
    fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
    const now = Date.now();
    const t = tNow / 1000;
    if (cocoon) {
      const w = (cocoon.userData.wobble as number | undefined) ?? 0;
      cocoon.userData.wobble = Math.max(0, w - dt * 2.5);
      const breathe = 1 + Math.sin(t * 2.2) * 0.025;
      cocoon.scale.set(breathe, breathe, breathe);
      cocoon.rotation.z = Math.sin(t * 25) * 0.12 * w;
    }
    stage.govern(dt);
    stage.update(dt, t);
    view.update(dt, now, t);
    for (const g of guests.values()) g.view.update(dt, now, t);
    world?.update(dt, now, t);
    stage.render();
    // The Live Activity's portrait of THIS creature, taken right after render (buffers aren't kept).
    if (wantSnapshot && live.available && view.visible && t > 3) {
      wantSnapshot = false;
      const h = view.screenHit();
      void live.setSnapshot(captureRegion(stage.renderer.domElement, h.x, h.y, h.r * 1.15));
    }
    if (!paused) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  addEventListener('resize', () => stage.resize());
}

/** Minute-by-minute sun refresh without refetching weather. */
function sunNow(s: Sky) {
  const p = sunPosition(skyClock(overrides(location.search).hour), s.lat, s.lon);
  return { sunElev: p.elevation, sunAz: p.azimuth };
}

function partOfDay() {
  const h = new Date().getHours();
  return h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}

function reasonText(reason: string, toast = false): string {
  const m: Record<string, string> = {
    'host-declined': toast ? 'Not this time — they said maybe later.' : 'not this time',
    closed: toast ? 'That KIN isn’t taking visitors right now.' : 'visits closed',
    full: toast ? 'Their place is full right now.' : 'full',
    busy: toast ? 'They’re busy right now.' : 'busy',
    timeout: toast ? 'No answer — maybe next time.' : 'no answer',
    'no-answer': toast ? 'No answer — maybe next time.' : 'no answer',
    'no-commit': toast ? 'The crossing didn’t finish, so it came straight back.' : 'crossing interrupted',
    lease: toast ? 'Lost touch with the other screen — safely home.' : 'lost touch',
    unknown: toast ? 'The other screen forgot the visit — safely home.' : 'host restarted',
    recall: toast ? 'Called home.' : 'called home',
    stale: toast ? 'That invitation expired.' : 'expired',
  };
  return m[reason] ?? (toast ? 'Back home safely.' : reason);
}


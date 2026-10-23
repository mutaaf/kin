// Dev harness for the experience redesign: Stage + creature + world + habitat + camera director
// (+ the shell once mounted), without app.ts. URL: ?hab=sky-meadow&hour=7.5&wx=clear&shot=spotlight
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import '../src/ui/style.css';
import * as THREE from 'three';
import { makeGenome } from '../src/core/genome';
import { applyWx, atHour, coarseLocation, type Sky } from '../src/env/sky';
import { CameraDirector, orthoRig, type Shot } from '../src/render/camera';
import { KinView } from '../src/render/kinView';
import { palette, Stage } from '../src/render/stage';
import { HABITATS, mountHabitat } from '../src/habitat';
import * as careModel from '../src/core/care';
import { Hud } from '../src/ui/hud';
import { Shell } from '../src/ui/shell';
import { browserKV } from '../src/persistence/store';
import { attachWorld } from '../src/world/attach';
import { newKin } from '../src/core/creature';

const q = new URLSearchParams(location.search);
const stage = new Stage(document.getElementById('stage')!);
const seed = Number(q.get('seed') ?? 28);
const genome = makeGenome(seed);
const view = new KinView(genome, stage);
view.placeAt(0.2, 0.3);
const kin = { ...newKin(Date.now(), seed), hatched: true, name: q.get('name') ?? 'Lumi' };
const world = q.has('noworld') ? null : attachWorld({ stage, view, kv: browserKV(), slot: 'harness' + seed, kin: () => kin });

let sky: Sky = {
  ...coarseLocation(), tempC: 20, windKmh: 8, windDir: 200, precipMm: 0, snow: false, cloud: 0.2, sunElev: 20, sunAz: 180, code: 0, fetchedAt: 0, source: 'override',
};
sky = atHour(sky, Number(q.get('hour') ?? 7.5));
if (q.get('wx')) sky = applyWx(sky, q.get('wx')!);
stage.setSky(sky);
const habitat = mountHabitat(stage, q.get('hab') ?? 'sky-meadow');
habitat.setSky(sky, palette(sky));
(document.querySelector('#stage .sky') as HTMLElement).style.display = 'none';

const director = new CameraDirector(orthoRig(stage), { bounds: () => habitat.bounds });
director.soloMode = (q.get('shot') as Shot) ?? 'spotlight';
director.setMode(director.soloMode);
director.follow(() => [{ pos: view.pos, height: view.height, size: genome.size }]);
// ── The shell, with stub providers shaped like the real ones (app.ts wires the real ones).
const hud = new Hud();
const shell = q.has('noshell')
  ? null
  : new Shell(document.getElementById('shell')!, {
      hud,
      reducedMotion: () => false,
      identity: () => {
        const c = world?.world.care;
        const bond = careModel.bondLevel(c?.bondXp ?? 140);
        return {
          name: kin.name, level: bond.level + 11, levelName: bond.name, progress: 0.62,
          affection: 0.78, energy: 0.82, mood: 0.74, moodWord: 'playful',
        };
      },
      persona: () => ({
        title: 'Sporty Explorer', dominant: 'athlete',
        blend: [{ id: 'athlete', label: 'Athlete', level: 7 }, { id: 'scholar', label: 'Scholar', level: 4 }, { id: 'pop', label: 'Pop Star', level: 3 }, { id: 'royal', label: 'Royal', level: 1 }],
        why: ['Loves protein berries and practising fetch at dawn'],
      }),
      today: () => [
        { icon: 'explore', text: 'Explored the meadow', at: Date.now() - 120_000 },
        { icon: 'collection', text: 'Found a moonflower seed', at: Date.now() - 720_000 },
        { icon: 'train', text: 'Practised a high five', at: Date.now() - 3_600_000 },
        { icon: 'friends', text: 'Visited Nox. Nox did a happy spin.', at: Date.now() - 7_200_000, hue: 280 },
      ],
      habitats: { list: HABITATS, current: () => q.get('hab') ?? 'sky-meadow', level: () => 2, select: (id) => (location.search = `?hab=${id}`) },
      actions: {
        feed: () => world?.ui.cue('feed'), play: () => world?.ui.cue('play'), bath: () => world?.ui.cue('bath'),
        train: () => world?.ui.openRing(), collection: () => world?.ui.openBook(),
        think: () => hud.toast('Think'), gather: () => hud.toast('Gather'), memories: () => hud.toast('Memories'), settings: () => hud.toast('Settings'),
      },
      camera: {
        enter: () => ((director.soloMode = 'portrait'), director.setMode('portrait')),
        exit: () => ((director.soloMode = 'spotlight'), director.setMode('spotlight')),
        snapshot: () => new Promise<Blob | null>((res) => (pendingSnap = res)),
      },
      ai: { ask: (qq) => hud.toast(`Ask: ${qq}`), analyze: () => hud.toast('Reading'), snackFromTopic: (t) => hud.toast(`Snack: ${t}`) },
    });
world?.ui.useShell();
hud.who(kin);
hud.skyLine(`${Math.round(sky.tempC * 1.8 + 32)}° · ${sky.precipMm > 0 ? 'rain' : 'clear'} · ${sky.place}`);
if (!q.has('idle')) hud.rail(true);
let pendingSnap: ((b: Blob | null) => void) | null = null;
(window as unknown as { kin: unknown }).kin = { stage, view, director, habitat, world, THREE, shell, hud };

let last = performance.now();
const frame = (tn: number) => {
  const dt = Math.min(0.05, (tn - last) / 1000);
  last = tn;
  const t = tn / 1000;
  stage.update(dt, t);
  view.update(dt, Date.now(), t);
  world?.update(dt, Date.now(), t);
  director.update(dt, t);
  habitat.update(dt, t, stage);
  stage.render();
  if (pendingSnap) {
    const done = pendingSnap;
    pendingSnap = null;
    stage.renderer.domElement.toBlob((b) => done(b), 'image/png');
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
addEventListener('resize', () => stage.resize());
document.title = 'ready';

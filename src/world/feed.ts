// Food for the mind. Snacks that shape who a KIN becomes: a trivia tart for a Scholar, arcade
// candy for a Gamer, sparkle pops for a Pop Star, sour fizz for a Brat, royal jelly for a Royal.
// They use the world's existing feeding gesture: a snack is a 'berry'-kind entity, so the care UI
// already lets you drag it to the KIN, and the KIN already eats one it finds on the ground.
// This module spawns them, notices when one is eaten, and reports which (so persona.ts can grow).
//
// ── Integration for app.ts (after attachWorld) ───────────────────────────────────────────────
//   import { FeedSystem } from './world/feed';
//   const feed = world && new FeedSystem(world.world, stage, kv, slot, kin.seed, {
//     onEaten: (s) => { grow({ k: 'fed', snack: s.id, deltas: s.deltas, label: s.name }); speech.say({ who: 'me', text: s.line(personaNow) }); },
//   });
//   // in frame(): feed?.update(now)
//   // "Feed it a topic" (Garden Book or Think sheet): const card = await snackFromTopic(text, ai); feed?.serve(card)
// ──────────────────────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { hash, rng } from '../core/rng';
import { HUE, type Archetype, type Levels } from '../core/persona';
import type { KV } from '../persistence/store';
import type { TopicCard } from '../ai/schema';

// Topic cards are validated in the shared AI schema (the Worker uses the same rules).
export { cleanTopic, localTopicCard, validTopicCard, type TopicCard } from '../ai/schema';
import type { Stage } from '../render/stage';
import type { Entity, World } from './world';

export type Shape = 'tart' | 'candy' | 'berry' | 'pop' | 'fizz' | 'jelly' | 'trail' | 'macaron' | 'bun';

export interface Snack {
  id: string;
  name: string;
  /** What it does to the mind (persona deltas; small). */
  deltas: Partial<Levels>;
  shape: Shape;
  /** Body and glow colours (hsl hue). */
  hue: number;
  glow: number;
  /** 1 common … 3 rare. */
  rarity: 1 | 2 | 3;
  /** What the KIN says after eating it, by its current dominant archetype. */
  lines: Partial<Record<Archetype | 'neutral', string>>;
  flavor: string;
  /** True for AI-made topic snacks. */
  custom?: boolean;
}

export const SNACKS: Snack[] = [
  {
    id: 'trivia-tart', name: 'trivia tart', shape: 'tart', hue: 205, glow: 190, rarity: 1, deltas: { scholar: 0.03 },
    flavor: 'Flaky crust, filled with fun facts.',
    lines: { neutral: 'Mm! Did you know tarts are round?', scholar: 'Delicious AND educational. A rare combination.', brat: 'Fine. It was *slightly* interesting.' },
  },
  {
    id: 'arcade-candy', name: 'arcade candy', shape: 'candy', hue: 265, glow: 290, rarity: 1, deltas: { gamer: 0.03 },
    flavor: 'Pixel-sweet. Worth a hundred points.',
    lines: { neutral: 'Blip! Bloop! More please!', gamer: 'Power-up acquired. *Combo ×3!*', royal: 'A peculiar little sweet. We approve.' },
  },
  {
    id: 'protein-berry', name: 'protein berry', shape: 'berry', hue: 22, glow: 35, rarity: 1, deltas: { athlete: 0.03 },
    flavor: 'Juicy, zingy, ready for laps.',
    lines: { neutral: 'Zing! I could run forever!', athlete: 'Fuel *loaded*. Ten laps. Go!', scholar: 'Vitamins, probably. Lots of them.' },
  },
  {
    id: 'sparkle-pop', name: 'sparkle pop', shape: 'pop', hue: 320, glow: 300, rarity: 1, deltas: { popstar: 0.03 },
    flavor: 'Fizzes like applause.',
    lines: { neutral: 'It tingles! Like a song!', popstar: 'Hit the lights. *I* am the show.', athlete: 'Sparkly fuel. Fast sparkly fuel.' },
  },
  {
    id: 'sour-fizz', name: 'sour fizz', shape: 'fizz', hue: 95, glow: 80, rarity: 1, deltas: { brat: 0.025 },
    flavor: 'Sharp, bubbly, a little cheeky.',
    lines: { neutral: 'Sour! Again! No wait. Again!', brat: 'Ugh. *Love* it. Don’t tell anyone.', royal: 'Most... invigorating.' },
  },
  {
    id: 'royal-jelly', name: 'royal jelly', shape: 'jelly', hue: 45, glow: 48, rarity: 2, deltas: { royal: 0.035 },
    flavor: 'Golden, wobbly, terribly refined.',
    lines: { neutral: 'Wobbly and golden! So fancy!', royal: 'At last, a snack befitting *us*.', brat: 'Okay this one is actually good.' },
  },
  {
    id: 'trail-crunch', name: 'trail crunch', shape: 'trail', hue: 140, glow: 120, rarity: 1, deltas: { explorer: 0.03 },
    flavor: 'Crunchy bits from far-off places.',
    lines: { neutral: 'Crunchy! It tastes like faraway.', explorer: 'Packed for the next *adventure*.', gamer: 'Side quest snack. Nice.' },
  },
  {
    id: 'rainbow-macaron', name: 'rainbow macaron', shape: 'macaron', hue: 185, glow: 330, rarity: 2, deltas: { artist: 0.03, popstar: 0.006 },
    flavor: 'Every bite a different colour.',
    lines: { neutral: 'It tasted like *seven colours*.', artist: 'I could paint this flavour.', scholar: 'Seven colours. I counted.' },
  },
  {
    id: 'moon-bun', name: 'moon bun', shape: 'bun', hue: 230, glow: 210, rarity: 3, deltas: { scholar: 0.015, explorer: 0.015, royal: 0.01 },
    flavor: 'Soft as a cloud, glows at night. Rare.',
    lines: { neutral: 'It glows inside me. Wow.', royal: 'Moonlight, served warm. Splendid.', explorer: 'Tastes like the far side of the sky.' },
  },
];

export const snackById = (id: string) => SNACKS.find((s) => s.id === id) ?? null;

/** Line the KIN says after eating, in its current voice. */
export function snackLine(s: Snack, dominant: Archetype | 'neutral'): string {
  return s.lines[dominant] ?? s.lines.neutral ?? `Yum, ${s.name}!`;
}

/**
 * Today's menu: three everyday snacks and, some days, a rare one. Deterministic per KIN and date,
 * so it changes every day (always something new) but is the same on every device.
 */
export function dailyMenu(dateKey: string, kinSeed: number): Snack[] {
  const r = rng(hash(`menu:${kinSeed}:${dateKey}`));
  const common = SNACKS.filter((s) => s.rarity === 1);
  const pool = [...common];
  const out: Snack[] = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
  const rare = SNACKS.filter((s) => s.rarity > 1);
  if (r() < 0.45) out.push(rare[Math.floor(r() * rare.length)]!);
  return out;
}

// ── Topic snacks: "feed it a topic" ────────────────────────────────────────────────────────────

export function snackFromCard(c: TopicCard): Snack {
  const top = (Object.entries(c.weights) as [Archetype, number][]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'explorer';
  const shapeBy: Record<Archetype, Shape> = {
    scholar: 'tart', gamer: 'candy', athlete: 'berry', popstar: 'pop', brat: 'fizz', royal: 'jelly', explorer: 'trail', artist: 'macaron',
  };
  return {
    id: `topic:${hash(c.name)}`, name: c.name, deltas: c.weights, shape: shapeBy[top], hue: HUE[top], glow: (HUE[top] + 20) % 360,
    rarity: 2, lines: { neutral: c.line }, flavor: c.flavor, custom: true,
  };
}

// ── Meshes: small, crisp, glowing a little so they read as special food ───────────────────────

const col = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l);

export function snackMesh(s: Snack): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshPhysicalMaterial({ color: col(s.hue, 0.65, 0.62), roughness: 0.35, clearcoat: 0.6, emissive: col(s.glow, 0.9, 0.35), emissiveIntensity: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: col(s.glow, 0.85, 0.72), emissive: col(s.glow, 0.9, 0.5), emissiveIntensity: 0.8, roughness: 0.3 });
  const cream = new THREE.MeshStandardMaterial({ color: '#fff4e6', roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    g.add(mesh);
    return mesh;
  };
  const sphere = new THREE.SphereGeometry(1, 28, 20);
  switch (s.shape) {
    case 'tart':
      add(new THREE.CylinderGeometry(0.05, 0.042, 0.028, 32), cream, 0, 0.014);
      add(sphere, body, 0, 0.03, 0, 0.044, 0.014, 0.044);
      for (let i = 0; i < 5; i++) add(sphere, accent, Math.cos(i * 1.26) * 0.025, 0.042, Math.sin(i * 1.26) * 0.025, 0.006, 0.006, 0.006);
      break;
    case 'candy':
      for (const [x, y] of [[0, 0], [0.022, 0], [-0.022, 0], [0, 0.022], [0, -0.022]] as const)
        add(new THREE.BoxGeometry(0.022, 0.022, 0.022), x === 0 && y === 0 ? accent : body, x, 0.03 + y, 0);
      break;
    case 'berry':
      add(sphere, body, 0, 0.035, 0, 0.034, 0.036, 0.034);
      add(new THREE.ConeGeometry(0.012, 0.02, 10), accent, 0, 0.074, 0);
      break;
    case 'pop': {
      const star = new THREE.OctahedronGeometry(0.035, 0);
      const m = add(star, body, 0, 0.075, 0, 1, 1, 0.45);
      m.rotation.z = Math.PI / 4;
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), cream, 0, 0.03, 0);
      add(sphere, accent, 0, 0.075, 0.017, 0.008, 0.008, 0.008);
      break;
    }
    case 'fizz':
      add(sphere, body, 0, 0.034, 0, 0.032, 0.04, 0.032);
      for (let i = 0; i < 4; i++) add(sphere, accent, (i - 1.5) * 0.012, 0.08 + (i % 2) * 0.01, 0.01, 0.006, 0.006, 0.006);
      break;
    case 'jelly':
      add(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), body, 0, 0.004, 0, 0.045, 0.05, 0.045);
      for (let i = 0; i < 5; i++) add(new THREE.ConeGeometry(0.006, 0.016, 8), accent, Math.cos(i * 1.26) * 0.022, 0.056, Math.sin(i * 1.26) * 0.022);
      break;
    case 'trail':
      for (let i = 0; i < 7; i++) add(sphere, i % 3 ? body : accent, Math.cos(i) * 0.022, 0.015 + (i % 3) * 0.012, Math.sin(i * 1.7) * 0.022, 0.014, 0.012, 0.014);
      break;
    case 'macaron':
      add(sphere, body, 0, 0.016, 0, 0.038, 0.014, 0.038);
      add(new THREE.CylinderGeometry(0.034, 0.034, 0.01, 28), cream, 0, 0.03, 0);
      add(sphere, accent, 0, 0.044, 0, 0.038, 0.014, 0.038);
      break;
    case 'bun':
      add(sphere, body, 0, 0.03, 0, 0.042, 0.03, 0.042);
      add(sphere, accent, 0.01, 0.05, 0.02, 0.012, 0.004, 0.012);
      break;
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = false));
  return g;
}

// ── The system: spawns today's menu, tracks what was eaten ─────────────────────────────────────

interface FeedState {
  day: string;
  eaten: string[];
}

export interface FeedEvents {
  onEaten: (s: Snack) => void;
}

export class FeedSystem {
  /** Entity id → snack, for snacks currently in the world. */
  private live = new Map<string, Snack>();
  private state: FeedState;
  private seq = 0;
  private lastCheck = 0;

  constructor(
    private world: World,
    private stage: Stage,
    private kv: KV,
    private slot: string,
    private kinSeed: number,
    private ev: FeedEvents,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    let s: FeedState = { day: today, eaten: [] };
    try {
      const raw = JSON.parse(kv.get(this.key) ?? 'null') as FeedState | null;
      if (raw && raw.day === today && Array.isArray(raw.eaten)) s = raw;
    } catch {
      /* fresh day */
    }
    this.state = s;
    this.restock();
  }

  private get key() {
    return `kin:v1:${this.slot}:feed`;
  }

  /** Today's menu, minus what's been eaten or is already out. Laid on the garden's front edge. */
  restock() {
    const menu = dailyMenu(this.state.day, this.kinSeed).filter((s) => !this.state.eaten.includes(s.id));
    const out = new Set([...this.live.values()].map((s) => s.id));
    menu.filter((s) => !out.has(s.id)).forEach((s, i) => this.serve(s, { x: -0.55 + i * 0.36, y: 0.12, z: 1.05 }));
  }

  /** Put a snack into the world (from the menu, or an AI topic card via snackFromCard). */
  serve(s: Snack, at = { x: 0.2 + (this.seq % 3) * 0.25, y: 0.35, z: 1.0 }) {
    const obj = snackMesh(s);
    obj.position.set(at.x, at.y, at.z);
    this.stage.world.add(obj);
    const id = `snack:${s.id}:${++this.seq}`;
    // 'berry' kind + 'carry' grab: the care UI's drag-to-mouth feeding and the KIN's own
    // "eat what's on the ground" behaviour both work with no changes to the world.
    const e = { id, kind: 'berry', obj, r: 0.12, grab: 'carry' as const, data: { ripeness: 1.1, snack: s.id } };
    const ph = this.world.physics;
    const entity = ph ? { ...e, body: ph.add({ id, shape: { ball: 0.04 }, material: 'berry', pos: at }) } : e;
    this.world.entities.set(id, entity as Entity);
    this.live.set(id, s);
    return id;
  }

  /** Call every frame (cheap: checks a few times a second). */
  update(now: number) {
    if (now - this.lastCheck < 250) return;
    this.lastCheck = now;
    // A day rolled over while open: new menu.
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== this.state.day) {
      this.state = { day: today, eaten: [] };
      this.save();
      this.restock();
    }
    for (const [id, s] of this.live) {
      const e = this.world.entities.get(id);
      if (e) {
        // Make it shimmer a little: special food.
        e.obj.rotation.y += 0.02;
        continue;
      }
      // Gone from the world without us removing it: it was eaten (fed by hand or found on the ground).
      this.live.delete(id);
      if (!s.custom) this.state.eaten = [...new Set([...this.state.eaten, s.id])];
      this.save();
      this.ev.onEaten(s);
    }
  }

  /** What's out right now (for the UI). */
  serving(): Snack[] {
    return [...this.live.values()];
  }

  private save() {
    this.kv.set(this.key, JSON.stringify(this.state));
  }

  dispose() {
    for (const id of this.live.keys()) this.world.removeEntity(id);
    this.live.clear();
  }
}

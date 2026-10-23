// Emotes: small, crisp, vector-drawn signs above a KIN (hearts, notes, Zzz, a sparkle, a sweat
// drop, a question mark, a little rain cloud for sulking, a "!"). Drawn once per kind into a
// 256 px canvas (sharp at DPR 3), shown as sprites that pop, float, sway and fade. Capped per
// creature so it never turns into confetti; nothing flashes.

import * as THREE from 'three';

export type EmoteKind = 'heart' | 'note' | 'zzz' | 'sparkle' | 'sweat' | 'question' | 'cloud' | 'exclaim';

const textures = new Map<EmoteKind, THREE.Texture>();

function draw(kind: EmoteKind): THREE.Texture {
  const hit = textures.get(kind);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // A soft white halo keeps every sign readable on any sky.
  const halo = (fn: () => void, fill: string, stroke = 'rgba(255,255,255,0.95)', w = 22) => {
    g.save();
    fn();
    g.lineWidth = w;
    g.strokeStyle = stroke;
    g.stroke();
    g.fillStyle = fill;
    g.fill();
    g.restore();
  };
  switch (kind) {
    case 'heart':
      halo(() => {
        g.beginPath();
        g.moveTo(0, 70);
        g.bezierCurveTo(-110, -5, -70, -95, 0, -45);
        g.bezierCurveTo(70, -95, 110, -5, 0, 70);
        g.closePath();
      }, '#ff6f91');
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.ellipse(-38, -38, 14, 9, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'note':
      halo(() => {
        g.beginPath();
        g.ellipse(-28, 52, 34, 26, -0.4, 0, Math.PI * 2);
        g.rect(-2, -80, 14, 132);
        g.moveTo(12, -80);
        g.quadraticCurveTo(70, -60, 62, -10);
        g.quadraticCurveTo(50, -40, 12, -44);
        g.closePath();
      }, '#9ea8ff');
      break;
    case 'zzz':
      g.font = '800 120px Geist Variable, ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 20;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.strokeText('z', -40, 40);
      g.fillStyle = '#7f8cf0';
      g.fillText('z', -40, 40);
      g.font = '800 84px Geist Variable, ui-sans-serif, system-ui, sans-serif';
      g.strokeText('z', 40, -35);
      g.fillText('z', 40, -35);
      break;
    case 'sparkle':
      halo(() => {
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const r = i % 2 ? 26 : 95;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
      }, '#ffd36e');
      break;
    case 'sweat':
      halo(() => {
        g.beginPath();
        g.moveTo(0, -85);
        g.bezierCurveTo(60, -10, 55, 70, 0, 70);
        g.bezierCurveTo(-55, 70, -60, -10, 0, -85);
        g.closePath();
      }, '#8fd3ff');
      break;
    case 'question':
    case 'exclaim':
      g.font = '800 190px Fraunces Variable, Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 22;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.strokeText(kind === 'question' ? '?' : '!', 0, 8);
      g.fillStyle = kind === 'question' ? '#6ee5ca' : '#e9af6b';
      g.fillText(kind === 'question' ? '?' : '!', 0, 8);
      break;
    case 'cloud':
      halo(() => {
        g.beginPath();
        g.arc(-45, 0, 40, Math.PI * 0.5, Math.PI * 1.5);
        g.arc(-5, -30, 50, Math.PI, Math.PI * 2);
        g.arc(50, -5, 38, Math.PI * 1.4, Math.PI * 0.5);
        g.closePath();
      }, '#aab4c8');
      g.strokeStyle = '#8fd3ff';
      g.lineWidth = 12;
      for (const x of [-35, 0, 35]) {
        g.beginPath();
        g.moveTo(x, 55);
        g.lineTo(x - 8, 90);
        g.stroke();
      }
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(kind, t);
  return t;
}

interface Live {
  sprite: THREE.Sprite;
  born: number;
  life: number;
  drift: number;
}

export class Emotes {
  private live: Live[] = [];
  constructor(private world: THREE.Object3D) {}

  /** Show an emote at `at` (world). Ignored when three are already showing. */
  show(kind: EmoteKind, at: THREE.Vector3, now: number, life = 1700) {
    if (this.live.length >= 3) return;
    const m = new THREE.SpriteMaterial({ map: draw(kind), transparent: true, depthWrite: false, depthTest: false });
    const s = new THREE.Sprite(m);
    s.position.copy(at);
    s.renderOrder = 10;
    s.scale.setScalar(0.001);
    this.world.add(s);
    this.live.push({ sprite: s, born: now, life, drift: (Math.random() - 0.5) * 0.25 });
  }

  /** Follow the creature: `anchor` is where new emotes rise from. */
  update(now: number, anchor: THREE.Vector3) {
    this.live = this.live.filter((e) => {
      const k = (now - e.born) / e.life;
      if (k >= 1) {
        this.world.remove(e.sprite);
        e.sprite.material.dispose();
        return false;
      }
      const pop = k < 0.15 ? backOut(k / 0.15) : 1;
      const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      e.sprite.scale.setScalar(0.17 * pop);
      e.sprite.material.opacity = fade;
      e.sprite.position.set(anchor.x + e.drift * k + Math.sin(k * 6) * 0.03, anchor.y + 0.1 + k * 0.32, anchor.z);
      return true;
    });
  }

  dispose() {
    for (const e of this.live) {
      this.world.remove(e.sprite);
      e.sprite.material.dispose();
    }
    this.live = [];
  }
}

const backOut = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

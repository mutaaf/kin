// Dev sheet for the cinematic speech and the theatre's new modes. Not shipped.
//   ?mode=styles     every persona's typography at once
//   ?mode=exchange   two KIN talking in turns, plus a thought
//   ?mode=subs       subtitles / accessibility mode
//   ?mode=analysis   the full analysis theatre against a mocked SSE stream
//   ?mode=ask        the ask theatre against a mocked SSE stream
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import '@fontsource/geist-mono/700.css';
import '../src/ui/style.css';
import { SpeechLayer, type Line, type SpeechStyle } from '../src/ui/speech';
import { HUE } from '../src/core/persona';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'styles';
const hud = document.getElementById('hud')!;

function head(id: string, x: number, y: number, hue: number, label = '') {
  const el = document.createElement('div');
  el.className = 'head';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.background = `radial-gradient(circle at 38% 32%, hsl(${hue} 60% 86%), hsl(${hue} 45% 68%))`;
  document.body.append(el);
  if (label) {
    const l = document.createElement('div');
    l.className = 'lab';
    l.style.left = `${x}px`;
    l.style.top = `${y}px`;
    l.textContent = label;
    document.body.append(l);
  }
  return () => ({ x, y, r: 46 });
}

const sheet = new SpeechLayer(hud, { subtitles: () => mode === 'subs', safeTop: 16 });

if (mode === 'styles' || mode === 'subs') {
  const rows: [SpeechStyle, string, string, string][] = [
    ['brat', 'Ugh. *Fine.* One lap. Then snacks.', 'sassy', 'Sporty Brat'],
    ['royal', 'A most *delightful* morning, wouldn’t you agree?', 'proud', 'Royal Scholar'],
    ['popstar', 'Lights, camera… *sparkle!* The garden is my stage.', 'happy', 'Pop Star'],
    ['scholar', 'Did you know rain falls at about *nine* metres a second?', 'curious', 'Bookish Scholar'],
    ['gamer', 'New high score! *Combo ×3* on the ball!', 'excited', 'Gamer'],
    ['athlete', 'Ten laps! *Go go go!*', 'excited', 'Athlete'],
    ['explorer', 'What’s past the mushroom? Let’s *find out*.', 'curious', 'Wandering Explorer'],
    ['artist', 'The sky is *seven* colours today.', 'content', 'Arty Pop Star'],
  ];
  const W = innerWidth;
  const cols = W < 700 ? 2 : 4;
  rows.forEach(([style, text, mood, title], i) => {
    const x = (W / cols) * ((i % cols) + 0.5) - (i % cols === cols - 1 ? 30 : 0);
    const y = (mode === 'subs' ? 180 : 250) + Math.floor(i / cols) * (W < 700 ? 230 : 290);
    const hue = HUE[style === 'neutral' ? 'popstar' : style];
    sheet.speaker(style, head(style, x, y, hue, style));
    if (mode === 'subs' && i > 1) return;
    setTimeout(() => void sheet.say({ who: style, text, style, mood, title, name: ['Lumi', 'Nox', 'Pip', 'Moli', 'Zuni', 'Kira', 'Tan', 'Suni'][i], hue, holdMs: 120_000 }), i * 120);
  });
}

if (mode === 'exchange') {
  const a = head('a', innerWidth * 0.3, innerHeight * 0.55, 330, 'Lumi');
  const b = head('b', innerWidth * 0.72, innerHeight * 0.6, 45, 'Nox');
  sheet.speaker('a', a);
  sheet.speaker('b', b);
  const lines: Line[] = [
    { who: 'a', text: 'You came! Did you bring *snacks*?', style: 'brat', mood: 'sassy', title: 'Sporty Brat', name: 'Lumi', hue: HUE.brat },
    { who: 'b', text: 'We brought *royal jelly*, naturally.', style: 'royal', mood: 'proud', title: 'Royal Scholar', name: 'Nox', hue: HUE.royal },
    { who: 'a', text: 'Ugh. *Best* friend ever.', style: 'brat', mood: 'happy', title: 'Sporty Brat', name: 'Lumi', hue: HUE.brat },
  ];
  void sheet.exchange(lines).then(() =>
    sheet.say({ who: 'b', text: 'Perhaps one more jelly before the rain…', kind: 'thought', style: 'royal', mood: 'content', title: 'Royal Scholar', name: 'Nox', hue: HUE.royal, holdMs: 60_000 }),
  );
}

// ── Mocked director stream for the theatre modes ──────────────────────────────────────────────
function mockSSE(kind: string, result: unknown, text: string) {
  const enc = new TextEncoder();
  const events = [
    ['prompt', { kind, provider: 'edge', model: '@cf/google/gemma-4-26b-a4b-it', colo: 'DFW', system: '(system prompt)', user: '(card)' }],
    ...text.match(/.{1,6}/g)!.map((t) => ['token', { text: t }]),
    ['done', { kind, result, errors: [], usage: { inTokens: 712, outTokens: 96, neurons: 9.1 }, cost: 0.0001, ms: 1600, ttft: 640 }],
  ] as const;
  return new Response(new ReadableStream({
    async start(c) {
      for (const [ev, data] of events) {
        c.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        await new Promise((r) => setTimeout(r, ev === 'token' ? 30 : 400));
      }
      c.close();
    },
  }), { headers: { 'content-type': 'text/event-stream' } });
}

if (mode === 'analysis' || mode === 'ask') {
  const analysis = {
    becoming: 'A Sporty Brat',
    reading: 'Lumi has started racing the rain to the mushroom and pouting at puddles that win. She eats sour fizz like it owes her money, then does a victory lap anyway. Underneath the drama is the fastest heart in the garden.',
    favorites: ['sour fizz', 'laps at dawn', 'Nox'],
    motto: 'Faster. Sassier. Then snacks.',
  };
  const answer = { answer: 'Hmph. My favourite snack is *sour fizz*. Obviously. Now watch me lap.', mood: 'sassy', act: 'wander' };
  window.fetch = async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.endsWith('/analyze')) return mockSSE('analyze', analysis, JSON.stringify(analysis));
    if (u.endsWith('/ask')) return mockSSE('ask', answer, JSON.stringify(answer));
    return new Response('{}', { status: 404 });
  };
  const card = {
    name: 'Lumi', temperament: 'playful', traits: { curiosity: 0.8, bravery: 0.6, playfulness: 0.9, warmth: 0.5, energy: 0.7 },
    drives: { energy: 0.6, social: 0.7, curious: 0.6, comfort: 0.8 }, weather: { word: 'rainy', tempC: 14, windKmh: 9 },
    timeOfDay: 'evening' as const, doing: 'sit', recent: [], friends: [{ name: 'Nox', meets: 4 }],
    persona: { title: 'Sporty Brat', blend: [['brat', 0.56], ['athlete', 0.44]] as ['brat' | 'athlete', number][], style: '56% Brat, 44% Athlete', why: ['ate sour fizz (5×) → more Brat', 'trains at fetch (9×) → more Athlete', 'was left waiting → more Brat'] },
  };
  const ai = { provider: 'edge' as const, model: '@cf/google/gemma-4-26b-a4b-it' };
  const th = await import('../src/ai/theatre');
  if (mode === 'analysis') void th.analyzeTheatre({ card, seed: 28, ai, reduced: false, onSettings: () => {} });
  else void th.askTheatre({ card, seed: 28, ai, reduced: false, onSettings: () => {}, question: 'What is your favourite snack?' });
}

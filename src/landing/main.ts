import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/geist';
import './landing.css';
import { startHero } from './hero';
import { runMany, type Tally } from './proof';
import { arcDemo, brainDemo, seedDemo, skyDemo, stitchDemo } from './sections';
import { Director } from './trailer';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => n.toLocaleString('en-US');

/** Run `fn` once, the first time `el` scrolls near the viewport. */
function onView(el: Element, fn: () => void, margin = '200px') {
  const io = new IntersectionObserver(
    (es) => {
      if (es.some((e) => e.isIntersecting)) {
        io.disconnect();
        fn();
      }
    },
    { rootMargin: margin },
  );
  io.observe(el);
}

// ── Hero
try {
  startHero($<HTMLCanvasElement>('field'), $('hero-stage'), (caption) => {
    const c = $('hero-caption');
    c.classList.add('swap');
    setTimeout(() => {
      c.textContent = caption;
      c.classList.remove('swap');
    }, 260);
  });
} catch (e) {
  console.warn('hero unavailable', e);
}

// ── Nav: solid once past the hero
const nav = document.querySelector('.nav')!;
new IntersectionObserver(([e]) => nav.classList.toggle('solid', !e?.isIntersecting), { rootMargin: '-64px 0px 0px 0px' }).observe($('top'));

// ── Reveal sections as they arrive
const reveal = new IntersectionObserver(
  (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), reveal.unobserve(e.target))),
  { rootMargin: '0px 0px -12% 0px' },
);
document.querySelectorAll('.idea, .section-head, .cta').forEach((el) => reveal.observe(el));

// ── Trailer: start the two live instances only when it's on screen.
const phones = $('phones');
const director = new Director(phones);
const total = 8;
director.onCaption = (title, sub, i) => {
  $('cap-title').textContent = title;
  $('cap-sub').textContent = sub;
  $('scene-count').textContent = `${String(i + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  const bar = $('progress');
  bar.style.transition = 'none';
  bar.style.width = `${(i / total) * 100}%`;
  requestAnimationFrame(() => {
    bar.style.transition = 'width 5.5s linear';
    bar.style.width = `${((i + 1) / total) * 100}%`;
  });
  const lt = document.querySelector('.lower-third')!;
  lt.classList.remove('show');
  requestAnimationFrame(() => lt.classList.add('show'));
};
onView(phones, () => {
  director.load();
  void director.play();
}, '300px');
const playBtn = $('play');
playBtn.addEventListener('click', () => {
  director.playing = !director.playing;
  playBtn.setAttribute('aria-pressed', String(director.playing));
  playBtn.setAttribute('aria-label', director.playing ? 'Pause the trailer' : 'Play the trailer');
  document.querySelector('.theatre')!.classList.toggle('paused', !director.playing);
});
const soundBtn = $('sound');
soundBtn.addEventListener('click', () => {
  const on = soundBtn.getAttribute('aria-pressed') !== 'true';
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', on ? 'Sound off' : 'Sound on');
  director.setSound(on);
});

// ── 01 stitch, 02 arc
stitchDemo(document.querySelector<HTMLElement>('[data-proof="stitch"]')!);
arcDemo(document.querySelector<HTMLElement>('[data-proof="arc"]')!);

// ── 03 the property test, live
const proofBox = document.querySelector<HTMLElement>('[data-proof="never"]')!;
const again = $<HTMLButtonElement>('proof-again');
let runs = 0;
const paint = (t: Tally, total: number) => {
  $('proof-count').textContent = fmt(t.runs);
  $('proof-lost').textContent = fmt(t.lost);
  $('proof-dup').textContent = fmt(t.twins);
  $('proof-drops').textContent = fmt(t.dropped);
  $('proof-crash').textContent = fmt(t.crashes);
  $('proof-bar').style.width = `${(t.runs / total) * 100}%`;
};
const runProof = () => {
  const total = 1000;
  again.hidden = true;
  proofBox.classList.add('running');
  $('proof-result').textContent = 'Crossing through a hostile network…';
  runMany(
    total,
    (t) => paint(t, total),
    (t) => {
      paint(t, total);
      proofBox.classList.remove('running');
      proofBox.classList.toggle('pass', t.broken === 0);
      $('proof-result').innerHTML =
        t.broken === 0
          ? `<b>${fmt(t.runs)} crossings · 0 lost · 0 duplicated.</b> Settled home ${fmt(t.home)} / away ${fmt(t.away)} · ${(t.ms / 1000).toFixed(1)} s in your browser.`
          : `<b>${fmt(t.broken)} of ${fmt(t.runs)} failed the invariant.</b> That would be a bug: please tell us.`;
      again.hidden = false;
    },
    1 + runs * 1000,
  );
  runs++;
};
onView(proofBox, runProof, '0px');
again.addEventListener('click', runProof);

// ── 04 sky, 05 brain, 07 seed
onView($('sky-strip'), () => void skyDemo($('sky-line'), $<HTMLCanvasElement>('sky-strip')));
brainDemo(document.querySelector<HTMLElement>('[data-proof="brain"]')!);
onView($('seed-canvas'), () => seedDemo($<HTMLCanvasElement>('seed-canvas'), $('seed-label'), $<HTMLButtonElement>('seed-next')));

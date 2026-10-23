// One icon family for the shell: 24px grid, 1.6 stroke, round joins, a single accent fill where
// it helps recognition. Inline SVG so they stay crisp at any pixel ratio and inherit colour.

const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  feed: svg('<path d="M12 6.2c-1.6-1.9-5.6-1.6-6.3 2.1-.6 3.2 1.5 8.4 4.1 9.4 1 .4 1.6-.3 2.2-.3s1.2.7 2.2.3c2.6-1 4.7-6.2 4.1-9.4-.7-3.7-4.7-4-6.3-2.1z"/><path d="M12 6.2c0-1.6.8-2.8 2.3-3.4" class="fx"/>'),
  play: svg('<circle cx="12" cy="12" r="7.6"/><path d="M5.2 9.2c4.3 1.4 9.3 1.4 13.6 0M6 15.6c3.9-1.6 8.1-1.6 12 0"/>'),
  explore: svg('<circle cx="12" cy="12" r="8"/><path d="M14.9 9.1l-1.8 4-4 1.8 1.8-4z" class="fx"/>'),
  train: svg('<path d="M12 3.8l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.2l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z"/>'),
  customize: svg('<path d="M8.6 4.8L5 6.6 3.6 10.8l2.8 1.1V19.4h11.2v-7.5l2.8-1.1L19 6.6l-3.6-1.8c-.5 1.6-1.8 2.6-3.4 2.6s-2.9-1-3.4-2.6z"/>'),
  camera: svg('<path d="M4.4 8.4h3.2l1.6-2.2h5.6l1.6 2.2h3.2v10H4.4z"/><circle cx="12" cy="13.2" r="3.4"/>'),
  home: svg('<path d="M4.6 11.2L12 5l7.4 6.2V19H14.6v-4.6H9.4V19H4.6z"/>'),
  friends: svg('<circle cx="8.6" cy="9.4" r="2.8"/><circle cx="16" cy="10.2" r="2.3"/><path d="M3.8 18.2c.6-2.8 2.6-4.3 4.8-4.3s4.2 1.5 4.8 4.3M13.6 14.7c.8-.6 1.6-.9 2.4-.9 1.8 0 3.4 1.2 3.9 3.6"/>'),
  party: svg('<path d="M5 19l3.6-10.4 6.8 6.8z"/><path d="M14 4.6v1.6M18.4 6.6l-1.2 1.2M19.6 11h-1.6M11.2 7.4c.8-.6 1.8-.6 2.6 0"/>'),
  sports: svg('<circle cx="12" cy="12" r="7.6"/><path d="M12 4.4v15.2M4.4 12h15.2M6.6 6.6c2.8 2.8 2.8 8 0 10.8M17.4 6.6c-2.8 2.8-2.8 8 0 10.8"/>'),
  collection: svg('<path d="M12 6.5c-2-1.5-4.5-2-7-1.6v12.6c2.5-.4 5 .1 7 1.6 2-1.5 4.5-2 7-1.6V4.9c-2.5-.4-5 .1-7 1.6z"/><path d="M12 6.5v12.6"/>'),
  memories: svg('<path d="M5 5.5h9.5a3 3 0 0 1 3 3V19H8a3 3 0 0 1-3-3z"/><path d="M8.5 9.5h5.5M8.5 12.5h4"/>'),
  think: svg('<path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6z"/><circle cx="18" cy="17.5" r="1.6"/><circle cx="7" cy="18.5" r="1"/>'),
  chat: svg('<path d="M5 6.4h14v9.2H11l-4 3.2v-3.2H5z"/><path d="M8.6 10.4h6.8M8.6 12.8h4.2"/>'),
  reading: svg('<circle cx="12" cy="12" r="7.6"/><path d="M12 4.4a7.6 7.6 0 0 0 0 15.2 3.8 3.8 0 0 0 0-7.6 3.8 3.8 0 0 1 0-7.6z"/><circle cx="12" cy="8.2" r=".7" class="dot"/>'),
  settings: svg('<circle cx="12" cy="12" r="2.6"/><path d="M12 3.8v2.4M12 17.8v2.4M3.8 12h2.4M17.8 12h2.4M6.2 6.2l1.7 1.7M16.1 16.1l1.7 1.7M6.2 17.8l1.7-1.7M16.1 7.9l1.7-1.7"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  heart: svg('<path d="M12 19s-7-4.1-7-9a3.9 3.9 0 0 1 7-2.4A3.9 3.9 0 0 1 19 10c0 4.9-7 9-7 9z"/>'),
  bolt: svg('<path d="M13.2 3.6L6.4 13.2h4.8l-.8 7.2 6.8-9.6h-4.8z"/>'),
  smile: svg('<circle cx="12" cy="12" r="7.6"/><path d="M8.8 13.6c1.6 2 4.8 2 6.4 0"/><circle cx="9.3" cy="10" r=".6" class="dot"/><circle cx="14.7" cy="10" r=".6" class="dot"/>'),
  lock: svg('<rect x="6" y="10.6" width="12" height="8.6" rx="2"/><path d="M8.8 10.6V8.4a3.2 3.2 0 0 1 6.4 0v2.2"/>'),
  ar: svg('<path d="M4.5 8V5.5h2.5M17 5.5h2.5V8M19.5 16v2.5H17M7 18.5H4.5V16"/><path d="M12 7.6l3.8 2.2v4.4L12 16.4l-3.8-2.2V9.8z"/>'),
  share: svg('<path d="M12 4.6v10M8.4 8.2L12 4.6l3.6 3.6M6 12.4v6.2h12v-6.2"/>'),
  sun: svg('<circle cx="12" cy="12" r="3.6"/><path d="M12 3.6v1.8M12 18.6v1.8M3.6 12h1.8M18.6 12h1.8M6 6l1.3 1.3M16.7 16.7L18 18M6 18l1.3-1.3M16.7 7.3L18 6"/>'),
  moon: svg('<path d="M16.6 15.4A6.6 6.6 0 0 1 8.6 5.4a6.6 6.6 0 1 0 8 10z"/>'),
  cloud: svg('<path d="M7.4 17.4h9.6a3.4 3.4 0 0 0 .4-6.8 5 5 0 0 0-9.6-1A3.9 3.9 0 0 0 7.4 17.4z"/>'),
  rain: svg('<path d="M7.4 14.4h9.6a3.2 3.2 0 0 0 .4-6.4 4.8 4.8 0 0 0-9.2-1A3.7 3.7 0 0 0 7.4 14.4z"/><path d="M9 17l-.8 2M12.4 17l-.8 2M15.8 17l-.8 2"/>'),
  snow: svg('<path d="M12 4v16M5.1 8l13.8 8M5.1 16L18.9 8"/>'),
};

export type IconName = keyof typeof ICONS;

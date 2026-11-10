// Print the store "What's New" text for the current version (package.json), from the same notes
// the in-app modal shows (src/whatsnew/notes.ts). `npm run whatsnew`; `npm run testflight` prints
// it after an upload so it can be pasted into App Store Connect. Needs Node 22.18+ (reads .ts).
import { readFileSync } from 'node:fs';
import { notesFor, storeWhatsNew } from '../src/whatsnew/notes.ts';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const r = notesFor(version);
if (!r) {
  console.error(`No What's new notes for ${version}. Add an entry to src/whatsnew/notes.ts.`);
  process.exit(1);
}
console.log(storeWhatsNew(r));

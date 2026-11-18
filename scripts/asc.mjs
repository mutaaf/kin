#!/usr/bin/env node
// App Store Connect API helper for KIN (adapted from Moon Club / Hinge Pop). No dependencies: Node's crypto
// signs the ES256 JWT. Reads .env.testflight (TEAM_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH). Never prints the key.
//
//   node scripts/asc.mjs whoami          check the key works and that the KIN app record exists
//   node scripts/asc.mjs capabilities    make sure APP_GROUPS is on both bundle ids (idempotent)
//   node scripts/asc.mjs signing         Apple Distribution cert + one App Store profile per bundle id (no cloud signing:
//                                        App Manager keys can't use it). Shares ~/.appstoreconnect/signing with the other apps.
//   node scripts/asc.mjs ship <build>    wait for processing, set What to Test, hand the build to the internal group
//   node scripts/asc.mjs crew            make sure the internal group exists and holds every team member
//   node scripts/asc.mjs call <METHOD> <path> [json]   debug passthrough
//   node scripts/asc.mjs store-lint     store/ texts against Apple's limits and kids wording (offline)
//   node scripts/asc.mjs store-meta     listing from store/, categories, content rights, review notes, free everywhere, attach the newest build
//   node scripts/asc.mjs store-rating   age rating from store/age-rating.json
//   node scripts/asc.mjs store-check    readiness report (read-only; exit 1 if blocked)
//   node scripts/asc.mjs submit --yes   send the version to App Review (the one public step)
//
// App record: "KIN: A Tiny Friend" (app id 6833212718; the store already had a "KIN"). The in-app name stays KIN.
// Testers: INTERNAL ONLY, group "KIN Crew" (access to all builds). No external group, no Beta App Review, no public link.
//
// The App Group group.com.mutaafaziz.kin can't be registered through this API (/v1/appGroups is a 404). It is
// already registered and assigned to com.mutaafaziz.kin and com.mutaafaziz.kin.widgets on the developer portal,
// so App Store profiles made here carry it.
import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_ID = "6833212718";
const BUNDLE = "com.mutaafaziz.kin";
/** Everything we sign: the app and its Live Activity extension, each with its own App Store profile. */
export const TARGETS = [
  { id: BUNDLE, profile: "KIN App Store" },
  { id: `${BUNDLE}.widgets`, profile: "KIN Widgets App Store" },
];
const INTERNAL = "KIN Crew";
const API = "https://api.appstoreconnect.apple.com";

function env() {
  const f = join(ROOT, ".env.testflight");
  const out = { ...process.env };
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/^\$HOME|^~/, process.env.HOME);
  }
  for (const k of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_PATH"]) if (!out[k]) throw new Error(`Missing ${k} in .env.testflight (docs/TESTFLIGHT.md)`);
  return out;
}

const b64u = (b) => Buffer.from(b).toString("base64url");
let cached;
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.jwt;
  const e = env();
  const head = b64u(JSON.stringify({ alg: "ES256", kid: e.ASC_KEY_ID, typ: "JWT" }));
  const body = b64u(JSON.stringify({ iss: e.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
  const sig = createSign("SHA256").update(`${head}.${body}`).sign({ key: createPrivateKey(readFileSync(e.ASC_KEY_PATH)), dsaEncoding: "ieee-p1363" });
  cached = { jwt: `${head}.${body}.${b64u(sig)}`, exp: now + 1200 };
  return cached.jwt;
}

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : {};
  if (!r.ok) {
    const why = (json.errors ?? []).map((x) => `${x.title}: ${x.detail}`).join("; ") || text;
    const err = new Error(`${method} ${path} → ${r.status} ${why}`);
    err.status = r.status;
    throw err;
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function whoami() {
  const a = (await api("GET", `/v1/apps/${APP_ID}?fields[apps]=name,bundleId`)).data;
  if (a.attributes.bundleId !== BUNDLE) throw new Error(`App ${APP_ID} is ${a.attributes.bundleId}, expected ${BUNDLE}`);
  console.log(`✓ key works: ${a.attributes.name} (${a.attributes.bundleId}, app id ${a.id})`);
}

async function bundleId(identifier) {
  const r = await api("GET", `/v1/bundleIds?filter[identifier]=${identifier}`);
  const hit = r.data.find((x) => x.attributes.identifier === identifier);
  if (!hit) throw new Error(`Bundle id ${identifier} is not registered (developer.apple.com → Identifiers).`);
  return hit;
}

async function capabilities() {
  for (const t of TARGETS) {
    const id = (await bundleId(t.id)).id;
    const have = new Set((await api("GET", `/v1/bundleIds/${id}/bundleIdCapabilities`)).data.map((c) => c.attributes.capabilityType));
    if (!have.has("APP_GROUPS")) {
      await api("POST", "/v1/bundleIdCapabilities", { data: { type: "bundleIdCapabilities", attributes: { capabilityType: "APP_GROUPS" },
        relationships: { bundleId: { data: { type: "bundleIds", id } } } } });
      console.log(`✓ enabled APP_GROUPS on ${t.id}`);
    } else console.log(`✓ ${t.id}: APP_GROUPS on`);
  }
}

/** Same Apple Distribution identity the other apps use (~/.appstoreconnect/signing), plus a fresh App Store profile per bundle id. */
async function signing() {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdirSync, readdirSync, unlinkSync } = await import("node:fs");
  const dir = join(process.env.HOME, ".appstoreconnect", "signing");
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, "dist.key");
  if (!existsSync(keyPath)) execFileSync("sh", ["-c", `openssl req -new -newkey rsa:2048 -nodes -keyout "${keyPath}" -out "${dir}/dist.csr" -subj "/CN=Apple Distribution" 2>/dev/null`]);
  const certs = await api("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION,IOS_DISTRIBUTION&limit=50");
  const idFile = join(dir, "dist.cer.id");
  let cert = existsSync(idFile) && certs.data.find((c) => c.id === readFileSync(idFile, "utf8").trim());
  if (!cert) {
    cert = (await api("POST", "/v1/certificates", { data: { type: "certificates", attributes: { certificateType: "DISTRIBUTION", csrContent: readFileSync(join(dir, "dist.csr"), "utf8") } } })).data;
    writeFileSync(idFile, cert.id);
    console.log("✓ created Apple Distribution certificate");
  }
  writeFileSync(join(dir, "dist.cer"), Buffer.from(cert.attributes.certificateContent, "base64"));
  execFileSync("sh", ["-c", `openssl x509 -inform der -in "${dir}/dist.cer" -out "${dir}/dist.pem" && (openssl pkcs12 -export -legacy -inkey "${keyPath}" -in "${dir}/dist.pem" -out "${dir}/dist.p12" -passout pass:moonclub 2>/dev/null || openssl pkcs12 -export -inkey "${keyPath}" -in "${dir}/dist.pem" -out "${dir}/dist.p12" -passout pass:moonclub); security import "${dir}/dist.p12" -k ~/Library/Keychains/login.keychain-db -P moonclub -T /usr/bin/codesign >/dev/null 2>&1 || true`]);
  console.log("✓ distribution identity in the login keychain");
  const pdir = join(process.env.HOME, "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles");
  mkdirSync(pdir, { recursive: true });
  for (const t of TARGETS) {
    const bid = await bundleId(t.id);
    const profs = await api("GET", `/v1/profiles?filter[name]=${encodeURIComponent(t.profile)}&limit=10`);
    for (const p of profs.data) await api("DELETE", `/v1/profiles/${p.id}`); // re-create so it always holds the current cert and App Group
    for (const f of readdirSync(pdir).filter((f) => f.endsWith(".mobileprovision"))) {
      try {
        const xml = execFileSync("security", ["cms", "-D", "-i", join(pdir, f)], { stdio: ["ignore", "pipe", "ignore"] }).toString();
        if (xml.match(/<key>Name<\/key>\s*<string>([^<]*)<\/string>/)?.[1] === t.profile) unlinkSync(join(pdir, f));
      } catch {}
    }
    const prof = (await api("POST", "/v1/profiles", { data: { type: "profiles", attributes: { name: t.profile, profileType: "IOS_APP_STORE" }, relationships: {
      bundleId: { data: { type: "bundleIds", id: bid.id } }, certificates: { data: [{ type: "certificates", id: cert.id }] } } } })).data;
    const content = Buffer.from(prof.attributes.profileContent, "base64");
    if (!content.toString("latin1").includes("group.com.mutaafaziz.kin")) throw new Error(`Profile “${t.profile}” lacks the App Group group.com.mutaafaziz.kin; assign it to ${t.id} on developer.apple.com → Identifiers.`);
    writeFileSync(join(pdir, `${prof.attributes.uuid}.mobileprovision`), content);
    console.log(`✓ installed profile “${t.profile}” (${prof.attributes.uuid}), with the App Group`);
  }
}

async function group() {
  const r = await api("GET", `/v1/betaGroups?filter[app]=${APP_ID}&filter[name]=${encodeURIComponent(INTERNAL)}`);
  if (r.data.length) return r.data[0];
  const c = await api("POST", "/v1/betaGroups", { data: { type: "betaGroups", attributes: { name: INTERNAL, isInternalGroup: true, hasAccessToAllBuilds: true },
    relationships: { app: { data: { type: "apps", id: APP_ID } } } } });
  console.log(`✓ created internal group “${INTERNAL}”`);
  return c.data;
}

/** Put every App Store Connect team member into the internal group (internal testers must be team users). */
async function crew() {
  const g = await group();
  const users = (await api("GET", "/v1/users?limit=100")).data;
  const have = new Set((await api("GET", `/v1/betaGroups/${g.id}/betaTesters?limit=200`)).data.map((t) => (t.attributes.email || "").toLowerCase()));
  let added = 0;
  for (const u of users) {
    const email = (u.attributes.username || "").toLowerCase();
    if (!email || have.has(email)) continue;
    try {
      await api("POST", "/v1/betaTesters", { data: { type: "betaTesters", attributes: { email, firstName: u.attributes.firstName, lastName: u.attributes.lastName },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: g.id }] } } } });
      added++;
    } catch (e) { if (e.status !== 409) throw e; }
  }
  console.log(`✓ “${INTERNAL}”: ${have.size + added} tester(s) (${added} added)`);
  return g;
}

async function ship(buildNumber) {
  if (!buildNumber) throw new Error("usage: asc.mjs ship <build number>");
  const { execFileSync } = await import("node:child_process");
  const notes = execFileSync("node", [join(ROOT, "scripts", "whats-new.mjs")]).toString()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").trim().slice(0, 4000); // TestFlight rejects emoji in whatsNew
  let b;
  for (let i = 0; i < 80; i++) { // up to ~40 minutes
    b = (await api("GET", `/v1/builds?filter[app]=${APP_ID}&filter[version]=${buildNumber}&limit=1`)).data[0];
    const state = b?.attributes.processingState;
    if (state === "VALID") break;
    if (state === "FAILED" || state === "INVALID") throw new Error(`Build ${buildNumber} processing ${state}`);
    process.stdout.write(i ? "." : `… waiting for build ${buildNumber} to finish processing `);
    await sleep(30000);
  }
  if (b?.attributes.processingState !== "VALID") throw new Error(`Build ${buildNumber} still processing; rerun: node scripts/asc.mjs ship ${buildNumber}`);
  console.log(`\n✓ build ${buildNumber} processed`);
  const locs = await api("GET", `/v1/builds/${b.id}/betaBuildLocalizations`);
  const en = locs.data.find((l) => l.attributes.locale === "en-US");
  if (en) await api("PATCH", `/v1/betaBuildLocalizations/${en.id}`, { data: { type: "betaBuildLocalizations", id: en.id, attributes: { whatsNew: notes } } });
  else await api("POST", "/v1/betaBuildLocalizations", { data: { type: "betaBuildLocalizations", attributes: { locale: "en-US", whatsNew: notes }, relationships: { build: { data: { type: "builds", id: b.id } } } } });
  console.log("✓ What to Test set from src/whatsnew/notes.ts");
  const g = await crew();
  // hasAccessToAllBuilds already covers it; adding explicitly is harmless and makes the check below certain.
  try { await api("POST", `/v1/betaGroups/${g.id}/relationships/builds`, { data: [{ type: "builds", id: b.id }] }); } catch (e) { if (e.status !== 409 && e.status !== 422) throw e; }
  const inGroup = (await api("GET", `/v1/betaGroups/${g.id}/builds?limit=50`)).data.some((x) => x.id === b.id);
  console.log(inGroup ? `✓ “${INTERNAL}” has build ${buildNumber} (internal testers only)` : `• “${INTERNAL}” has access to all builds; ${buildNumber} shows up there`);
}

async function call(method, path, body) { console.log(JSON.stringify(await api(method, path, body ? JSON.parse(body) : undefined), null, 2)); }

// ── App Store listing and submission (ported from cold-gas/ios/scripts/asc.mjs) ─────────────────────────────
// Everything below edits only the draft App Store version (reversible, nothing public) except `submit`, which sends
// the version to App Review and needs --yes. The listing lives in store/ as plain files, edited by hand.
const STORE_DIR = join(ROOT, "store");
const version = () => JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const stxt = (f) => readFileSync(join(STORE_DIR, f), "utf8").trim();
const sjson = (f) => JSON.parse(readFileSync(join(STORE_DIR, f), "utf8"));
export function storeListing() {
  const l = sjson("listing.json");
  return { ...l, subtitle: stxt("subtitle.txt"), keywords: stxt("keywords.txt"), promotionalText: stxt("promotional-text.txt"),
    description: stxt("description.txt"), reviewNotes: stxt("review-notes.txt"), copyright: `${new Date().getUTCFullYear()} ${l.copyrightHolder}` };
}
/** Apple's limits, checked offline. */
function storeLint() {
  const L = storeListing();
  const limits = { name: 30, subtitle: 30, keywords: 100, promotionalText: 170, description: 4000, reviewNotes: 4000 };
  let bad = 0;
  for (const [k, max] of Object.entries(limits)) {
    const n = [...L[k]].length;
    if (n > max) { console.log(`✗ ${k}: ${n} > ${max}`); bad++; } else console.log(`✓ ${k}: ${n}/${max}`);
  }
  // A general-audience listing must not market to kids (Moon Club's 2.3.8 rejection, 2026-11-05).
  for (const k of ["subtitle", "keywords", "promotionalText", "description"]) if (/\b(kids?|children|child|toddlers?|preschool)\b/i.test(L[k])) { console.log(`✗ ${k} has kids wording (2.3.8)`); bad++; }
  if (bad) process.exitCode = 1;
}
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);
async function appInfo() {
  const r = await api("GET", `/v1/apps/${APP_ID}/appInfos`);
  return r.data.find((i) => i.attributes.appStoreState !== "READY_FOR_SALE") ?? r.data[0];
}
async function storeVersion() {
  const all = (await api("GET", `/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20`)).data;
  return { sv: all.find((x) => EDITABLE.has(x.attributes.appStoreState)), shipped: all.some((x) => x.attributes.appStoreState === "READY_FOR_SALE") };
}
async function upsert(listPath, type, createRel, match, attributes) {
  const hit = (await api("GET", listPath)).data.find(match);
  if (hit) { const { locale, ...rest } = attributes; return (await api("PATCH", `/v1/${type}/${hit.id}`, { data: { type, id: hit.id, attributes: rest } })).data; }
  return (await api("POST", `/v1/${type}`, { data: { type, attributes, relationships: createRel } })).data;
}
/** Newest processed, unexpired build of package.json's version (or --build <number>). */
async function storeBuild() {
  const want = process.argv.includes("--build") ? process.argv[process.argv.indexOf("--build") + 1] : null;
  const pre = (await api("GET", `/v1/preReleaseVersions?filter[app]=${APP_ID}&filter[version]=${version()}&filter[platform]=IOS`)).data[0];
  if (!pre) return null;
  const builds = (await api("GET", `/v1/builds?filter[preReleaseVersion]=${pre.id}&filter[processingState]=VALID&sort=-uploadedDate&limit=50`)).data.filter((b) => !b.attributes.expired);
  return want ? builds.find((b) => b.attributes.version === want) ?? null : builds[0] ?? null;
}

async function storeMeta() {
  const e = env();
  const S = storeListing();
  if (S.forVersion !== version()) throw new Error(`store/ is written for ${S.forVersion}, package.json is ${version()}: update store/ first.`);
  const { sv, shipped } = await storeVersion();
  if (!sv) throw new Error("No editable App Store version");
  const v = version();
  if (sv.attributes.versionString !== v) {
    await api("PATCH", `/v1/appStoreVersions/${sv.id}`, { data: { type: "appStoreVersions", id: sv.id, attributes: { versionString: v } } });
    console.log(`✓ App Store version ${sv.attributes.versionString} → ${v} (matches the builds)`);
  }
  await api("PATCH", `/v1/appStoreVersions/${sv.id}`, { data: { type: "appStoreVersions", id: sv.id, attributes: { copyright: S.copyright } } });
  try {
    await api("PATCH", `/v1/appStoreVersions/${sv.id}`, { data: { type: "appStoreVersions", id: sv.id, attributes: { usesIdfa: false } } });
    console.log("✓ copyright, usesIdfa = no");
  } catch (err) { console.log(`• usesIdfa not set (${err.message.split("→")[1]?.trim()})`); }
  const loc = { description: S.description, keywords: S.keywords, promotionalText: S.promotionalText, supportUrl: S.supportUrl, marketingUrl: S.marketingUrl };
  await upsert(`/v1/appStoreVersions/${sv.id}/appStoreVersionLocalizations`, "appStoreVersionLocalizations",
    { appStoreVersion: { data: { type: "appStoreVersions", id: sv.id } } }, (l) => l.attributes.locale === "en-US", { locale: "en-US", ...loc });
  console.log(`✓ en-US listing: description, keywords, promotional text, support + marketing URLs${shipped ? "" : " (What's New starts with the 2nd release)"}`);
  const info = await appInfo();
  await upsert(`/v1/appInfos/${info.id}/appInfoLocalizations`, "appInfoLocalizations", { appInfo: { data: { type: "appInfos", id: info.id } } },
    (l) => l.attributes.locale === "en-US", { locale: "en-US", name: S.name, subtitle: S.subtitle, privacyPolicyUrl: S.privacyPolicyUrl });
  console.log(`✓ name “${S.name}”, subtitle, privacy policy URL`);
  const rel = (id) => ({ data: id ? { type: "appCategories", id } : null });
  const c = S.categories;
  await api("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships: {
    primaryCategory: rel(c.primary), primarySubcategoryOne: rel(c.primarySubcategories[0]), primarySubcategoryTwo: rel(c.primarySubcategories[1]), secondaryCategory: rel(c.secondary) } } });
  console.log(`✓ categories: ${c.primary} › ${c.primarySubcategories.join(", ")}; ${c.secondary}`);
  await api("PATCH", `/v1/apps/${APP_ID}`, { data: { type: "apps", id: APP_ID, attributes: { contentRightsDeclaration: S.contentRights } } });
  console.log(`✓ content rights: ${S.contentRights}`);
  for (const k of ["BETA_CONTACT_FIRST", "BETA_CONTACT_LAST", "BETA_CONTACT_EMAIL", "BETA_CONTACT_PHONE"]) if (!e[k]) throw new Error(`Missing ${k} in .env.testflight`);
  const review = { contactFirstName: e.BETA_CONTACT_FIRST, contactLastName: e.BETA_CONTACT_LAST, contactEmail: e.BETA_CONTACT_EMAIL, contactPhone: e.BETA_CONTACT_PHONE,
    demoAccountRequired: false, notes: S.reviewNotes };
  const rd = await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreReviewDetail`).catch((err) => (err.status === 404 ? { data: null } : Promise.reject(err)));
  if (rd.data) await api("PATCH", `/v1/appStoreReviewDetails/${rd.data.id}`, { data: { type: "appStoreReviewDetails", id: rd.data.id, attributes: review } });
  else await api("POST", "/v1/appStoreReviewDetails", { data: { type: "appStoreReviewDetails", attributes: review, relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: sv.id } } } } });
  console.log("✓ App Review contact and notes");
  await storePricing();
  const build = await storeBuild();
  if (!build) console.log(`• no processed build for ${v} yet: npm run testflight, then store-meta again`);
  else {
    await api("PATCH", `/v1/appStoreVersions/${sv.id}/relationships/build`, { data: { type: "builds", id: build.id } });
    console.log(`✓ build ${build.attributes.version} attached`);
  }
}

/** Free in every territory, including new ones. A new app has no price schedule at all. */
async function storePricing() {
  const have = await api("GET", `/v1/apps/${APP_ID}/appPriceSchedule?include=manualPrices`).catch(() => null);
  if (!have?.included?.some((x) => x.type === "appPrices")) {
    const points = await api("GET", `/v1/apps/${APP_ID}/appPricePoints?filter[territory]=USA&limit=200`);
    const zero = points.data.find((p) => Number(p.attributes.customerPrice) === 0);
    if (!zero) throw new Error("No free price point for USA");
    await api("POST", "/v1/appPriceSchedules", {
      data: { type: "appPriceSchedules", relationships: { app: { data: { type: "apps", id: APP_ID } }, baseTerritory: { data: { type: "territories", id: "USA" } },
        manualPrices: { data: [{ type: "appPrices", id: "${free}" }] } } },
      included: [{ type: "appPrices", id: "${free}", attributes: { startDate: null }, relationships: { appPricePoint: { data: { type: "appPricePoints", id: zero.id } } } }],
    });
  }
  console.log("✓ price: free");
  const avail = await api("GET", `/v1/apps/${APP_ID}/appAvailabilityV2`).catch((err) => (err.status === 404 ? null : Promise.reject(err)));
  if (avail?.data) { console.log("✓ availability already set"); return; }
  const territories = [];
  for (let next = "/v1/territories?limit=200"; next; ) {
    const r = await api("GET", next.replace(API, ""));
    territories.push(...r.data.map((t) => t.id));
    next = r.links?.next;
  }
  await api("POST", "/v2/appAvailabilities", {
    data: { type: "appAvailabilities", attributes: { availableInNewTerritories: true }, relationships: { app: { data: { type: "apps", id: APP_ID } },
      territoryAvailabilities: { data: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t}}` })) } } },
    included: territories.map((t) => ({ type: "territoryAvailabilities", id: `\${${t}}`, attributes: { available: true, releaseDate: null, preOrderEnabled: false }, relationships: { territory: { data: { type: "territories", id: t } } } })),
  });
  console.log(`✓ available in all ${territories.length} territories (and new ones)`);
}

/** Age rating, answered truthfully from store/age-rating.json (each answer's reason is in that file). */
async function storeRating() {
  const RATING = sjson("age-rating.json").answers;
  const info = await appInfo();
  const d = await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const known = new Set(Object.keys(d.data.attributes));
  const attrs = Object.fromEntries(Object.entries(RATING).filter(([k]) => known.has(k)));
  await api("PATCH", `/v1/ageRatingDeclarations/${d.data.id}`, { data: { type: "ageRatingDeclarations", id: d.data.id, attributes: attrs } });
  const unanswered = Object.entries((await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data.attributes).filter(([k, v]) => v === null && !/kidsAgeBand|Url|Number|brazil|korea/i.test(k)).map(([k]) => k);
  const after = (await api("GET", `/v1/appInfos/${info.id}`)).data.attributes;
  console.log(`✓ age rating questionnaire: ${Object.keys(attrs).length} answers → ${after.appStoreAgeRating ?? "(rating computed on submit)"}`);
  if (unanswered.length) console.log(`• still unanswered: ${unanswered.join(", ")}`);
}

/** Readiness report: every blocker and how to fix it. Exit 1 if anything blocks submission. Read-only. */
async function storeCheck() {
  const out = [];
  const ok = (m) => out.push(["ok", m]);
  const bad = (m, fix) => out.push(["block", m, fix]);
  const warn = (m, fix) => out.push(["warn", m, fix]);
  const v = version();
  const { sv } = await storeVersion();
  if (!sv) bad("No editable App Store version", "App Store Connect");
  else {
    if (sv.attributes.versionString !== v) bad(`App Store version is ${sv.attributes.versionString}, package.json is ${v}`, "node scripts/asc.mjs store-meta");
    else ok(`App Store version ${v} (${sv.attributes.appStoreState}, release ${sv.attributes.releaseType})`);
    if (sv.attributes.usesIdfa == null) warn("usesIdfa unanswered", "node scripts/asc.mjs store-meta"); else ok(`usesIdfa = ${sv.attributes.usesIdfa}`);
    const b = (await api("GET", `/v1/appStoreVersions/${sv.id}/build`).catch(() => ({ data: null }))).data;
    if (!b) bad("No build attached", "npm run testflight, then node scripts/asc.mjs store-meta");
    else ok(`Build ${b.attributes.version} attached${b.attributes.usesNonExemptEncryption === false ? " (no non-exempt encryption)" : ""}`);
    const loc = (await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreVersionLocalizations`)).data.find((l) => l.attributes.locale === "en-US");
    const missing = loc ? ["description", "keywords", "supportUrl"].filter((k) => !loc.attributes[k]) : ["en-US listing"];
    if (missing.length) bad(`Listing incomplete: ${missing.join(", ")}`, "node scripts/asc.mjs store-meta"); else ok("Listing: description, keywords, URLs");
    if (loc) {
      const sets = (await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`)).data;
      for (const [type, label] of [["APP_IPHONE_67", '6.9" iPhone'], ["APP_IPAD_PRO_3GEN_129", '13" iPad']]) {
        const set = sets.find((x) => x.attributes.screenshotDisplayType === type);
        const n = set ? (await api("GET", `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=10`)).data.filter((x) => x.attributes.assetDeliveryState?.state === "COMPLETE").length : 0;
        if (!n) bad(`No ${label} screenshots`, "lobby push kin"); else ok(`${label} screenshots: ${n}`);
      }
    }
    const r = (await api("GET", `/v1/appStoreVersions/${sv.id}/appStoreReviewDetail`).catch(() => ({ data: null }))).data?.attributes;
    if (!r?.contactEmail || !r?.contactPhone || !r?.notes) bad("App Review contact or notes missing", "node scripts/asc.mjs store-meta"); else ok("App Review contact and notes");
  }
  const info = await appInfo();
  const il = (await api("GET", `/v1/appInfos/${info.id}/appInfoLocalizations`)).data.find((l) => l.attributes.locale === "en-US")?.attributes;
  if (!il?.privacyPolicyUrl) bad("No privacy policy URL", "node scripts/asc.mjs store-meta"); else ok(`Name: ${il.name} — ${il.subtitle ?? "(no subtitle)"}`);
  const cat = (await api("GET", `/v1/appInfos/${info.id}/primaryCategory`).catch(() => ({ data: null }))).data;
  if (!cat) bad("No primary category", "node scripts/asc.mjs store-meta"); else ok(`Primary category: ${cat.id}`);
  const ard = (await api("GET", `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data.attributes;
  const nulls = Object.entries(ard).filter(([k, x]) => x === null && !/kidsAgeBand|Url|Number|brazil|korea/i.test(k)).map(([k]) => k);
  if (nulls.length) bad(`Age rating unanswered: ${nulls.join(", ")}`, "node scripts/asc.mjs store-rating"); else ok(`Age rating answered (kids age band: ${ard.kidsAgeBand ?? "none"})`);
  const attrs = (await api("GET", `/v1/apps/${APP_ID}`)).data.attributes;
  if (!attrs.contentRightsDeclaration) bad("Content rights not declared", "node scripts/asc.mjs store-meta"); else ok(`Content rights: ${attrs.contentRightsDeclaration}`);
  const ps = await api("GET", `/v1/apps/${APP_ID}/appPriceSchedule?include=manualPrices`).catch(() => null);
  if (!ps?.included?.some((x) => x.type === "appPrices")) bad("No price set", "node scripts/asc.mjs store-meta"); else ok("Price schedule set");
  const av = await api("GET", `/v1/apps/${APP_ID}/appAvailabilityV2`).catch(() => null);
  if (!av?.data) bad("Availability not set", "node scripts/asc.mjs store-meta"); else ok("Availability set");
  for (const [k, u] of [["Privacy policy", storeListing().privacyPolicyUrl], ["Support", storeListing().supportUrl]]) {
    const page = await fetch(u).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    if (!page || !new RegExp(k.split(" ")[0], "i").test(page.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "")) bad(`${k} page doesn't load: ${u}`, "npm run deploy");
    else ok(`${k}: ${u}`);
  }
  warn("App Privacy (the nutrition label) has no API", "App Store Connect → App Privacy: the answers in store/app-privacy.md, then Publish");
  const icon = { ok: "✓", warn: "•", block: "✗" };
  for (const [k, m, fix] of out) console.log(`${icon[k]} ${m}${fix ? `\n    → ${fix}` : ""}`);
  const blockers = out.filter((x) => x[0] === "block").length;
  console.log(blockers ? `\n${blockers} blocker(s) before \`node scripts/asc.mjs submit --yes\`.` : "\nReady once the App Privacy label is published: node scripts/asc.mjs submit --yes");
  if (blockers) process.exitCode = 1;
}

/** Send the draft version to App Review. Needs --yes: the one public step. */
async function submit() {
  if (!process.argv.includes("--yes")) { console.log("This sends KIN to App Review. Check first: node scripts/asc.mjs store-check\nThen: node scripts/asc.mjs submit --yes"); process.exitCode = 2; return; }
  const { sv } = await storeVersion();
  if (!sv) throw new Error("No editable App Store version");
  const open = (await api("GET", `/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&limit=5`)).data[0];
  const subm = open ?? (await api("POST", "/v1/reviewSubmissions", { data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: { data: { type: "apps", id: APP_ID } } } } })).data;
  const items = (await api("GET", `/v1/reviewSubmissions/${subm.id}/items?include=appStoreVersion`)).data;
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === sv.id))
    await api("POST", "/v1/reviewSubmissionItems", { data: { type: "reviewSubmissionItems", relationships: { reviewSubmission: { data: { type: "reviewSubmissions", id: subm.id } }, appStoreVersion: { data: { type: "appStoreVersions", id: sv.id } } } } });
  await api("PATCH", `/v1/reviewSubmissions/${subm.id}`, { data: { type: "reviewSubmissions", id: subm.id, attributes: { submitted: true } } });
  for (let i = 0; i < 20; i++) {
    const st = (await api("GET", `/v1/appStoreVersions/${sv.id}`)).data.attributes.appStoreState;
    if (st !== "PREPARE_FOR_SUBMISSION") { console.log(`✓ KIN ${sv.attributes.versionString} submitted (submission ${subm.id}): ${st}`); return; }
    await sleep(3000);
  }
  console.log(`• submitted (submission ${subm.id}); the version state hasn't moved yet`);
}

const [cmd, arg] = process.argv.slice(2);
const run = { whoami, capabilities, signing, crew, ship: () => ship(arg), call: () => call(arg, process.argv[4], process.argv[5]),
  "store-lint": storeLint, "store-meta": storeMeta, "store-rating": storeRating, "store-check": storeCheck, submit }[cmd];
if (!run) { console.log("usage: asc.mjs whoami | capabilities | signing | crew | ship <build> | store-lint | store-meta [--build N] | store-rating | store-check | submit --yes | call <METHOD> <path> [json]"); process.exit(2); }
Promise.resolve().then(run).catch((e) => { console.error("✗ " + e.message); process.exit(1); });

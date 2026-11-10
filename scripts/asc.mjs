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

const [cmd, arg] = process.argv.slice(2);
const run = { whoami, capabilities, signing, crew, ship: () => ship(arg), call: () => call(arg, process.argv[4], process.argv[5]) }[cmd];
if (!run) { console.log("usage: asc.mjs whoami | capabilities | signing | crew | ship <build> | call <METHOD> <path> [json]"); process.exit(2); }
Promise.resolve().then(run).catch((e) => { console.error("✗ " + e.message); process.exit(1); });

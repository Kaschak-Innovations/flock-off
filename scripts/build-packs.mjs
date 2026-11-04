#!/usr/bin/env node
/**
 * Builds trip packs: one JSON file per US state with every mapped license plate reader and fixed
 * speed camera, straight from OpenStreetMap via Overpass. Run nightly by
 * .github/workflows/build-packs.yml, which uploads the result to Workers KV for the worker to serve.
 *
 *   node scripts/build-packs.mjs <out-dir> [STATE ...]      e.g. node scripts/build-packs.mjs packs-out NH VT
 *
 * Output: <out-dir>/<CODE>.json for each state, <out-dir>/index.json, and <out-dir>/kv.json (the
 * key/value list `wrangler kv bulk put` takes).
 *
 * In CI (CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID and CF_KV_NAMESPACE set) each state is uploaded to KV
 * the moment it is built, the index is merged with the one already in KV (a state that fails keeps
 * its previous pack), states run oldest-first, and the run stops starting new states once
 * BUDGET_MIN minutes have passed, so a slow night still publishes everything it finished.
 *
 * Pack format (kept short; a big state is a few thousand rows):
 *   { code, name, updated, count, cameras: [[osmId, kind, lat, lon, direction|null, manufacturer|null], ...] }
 *   osmId "n123" or "w456"; kind "a" (ALPR) or "s" (speed camera); direction is the raw OSM tag.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const USER_AGENT = 'FlockOff-packs/1.0 (+https://github.com/Kaschak-Innovations/flock-off)';
const PAUSE_MS = 4000;
const REQUEST_TIMEOUT_MS = 200_000;
const BUDGET_MS = Number(process.env.BUDGET_MIN ?? 70) * 60_000;

const CF = {
  token: process.env.CLOUDFLARE_API_TOKEN,
  account: process.env.CF_ACCOUNT_ID,
  ns: process.env.CF_KV_NAMESPACE,
};
const kvEnabled = Boolean(CF.token && CF.account && CF.ns);

function kvUrl(key) {
  return `https://api.cloudflare.com/client/v4/accounts/${CF.account}/storage/kv/namespaces/${CF.ns}/values/${encodeURIComponent(key)}`;
}

async function kvGet(key) {
  const res = await fetch(kvUrl(key), { headers: { Authorization: `Bearer ${CF.token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV get ${key}: ${res.status}`);
  return res.text();
}

async function kvPut(key, value) {
  const res = await fetch(kvUrl(key), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF.token}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res.ok) throw new Error(`KV put ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export function stateQuery(code) {
  return `[out:json][timeout:240];
area["ISO3166-2"="US-${code}"]["boundary"="administrative"]->.a;
(
  node["man_made"="surveillance"]["surveillance:type"="ALPR"](area.a);
  way["man_made"="surveillance"]["surveillance:type"="ALPR"](area.a);
  node["highway"="speed_camera"](area.a);
);
out center;`;
}

/** Overpass elements -> compact rows. Mirrors elementToCamera in src/data/overpass.ts. */
export function toRows(elements) {
  const rows = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const kind = tags['surveillance:type'] === 'ALPR' ? 'a' : tags.highway === 'speed_camera' ? 's' : 'a';
    const dir = tags.direction ?? tags['camera:direction'] ?? null;
    rows.push([`${el.type[0]}${el.id}`, kind, Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6, dir, tags.manufacturer ?? tags.brand ?? null]);
  }
  rows.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return rows;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`${endpoint} ${res.status}`);
      if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      if (body.remark && /runtime error|timed out/i.test(body.remark)) throw new Error(`${endpoint}: ${body.remark}`);
      return body.elements ?? [];
    } catch (e) {
      last = e;
      console.error(`  attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : e}`);
      await sleep(20000 * (attempt + 1));
    }
  }
  throw last;
}

async function main() {
  const started = Date.now();
  const [outDir = 'packs-out', ...only] = process.argv.slice(2);
  await mkdir(outDir, { recursive: true });

  // Start from the published index so failed or skipped states keep their last good pack.
  let previous = { states: [] };
  if (kvEnabled) {
    try {
      previous = JSON.parse((await kvGet('index')) ?? '{"states":[]}');
    } catch (e) {
      console.error(`could not read the existing index: ${e instanceof Error ? e.message : e}`);
    }
  }
  const byCode = new Map(previous.states.map((s) => [s.code, s]));

  // Oldest (or missing) first, so a run cut short by the time budget still makes progress.
  const codes = (only.length ? only.map((c) => c.toUpperCase()) : Object.keys(STATES)).sort(
    (a, b) => (byCode.get(a)?.updated ?? 0) - (byCode.get(b)?.updated ?? 0),
  );

  const kv = [];
  const failed = [];
  const skipped = [];
  let built = 0;

  const publishIndex = async () => {
    const index = { updated: Date.now(), states: [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name)), failed };
    const json = JSON.stringify(index);
    await writeFile(join(outDir, 'index.json'), json);
    if (kvEnabled) await kvPut('index', json);
    return index;
  };

  for (const code of codes) {
    const name = STATES[code];
    if (!name) throw new Error(`Unknown state ${code}`);
    if (Date.now() - started > BUDGET_MS) {
      skipped.push(code);
      continue;
    }
    try {
      const rows = toRows(await overpass(stateQuery(code)));
      const updated = Date.now();
      const json = JSON.stringify({ code, name, updated, count: rows.length, cameras: rows });
      await writeFile(join(outDir, `${code}.json`), json);
      kv.push({ key: `pack:${code}`, value: json });
      if (kvEnabled) await kvPut(`pack:${code}`, json);
      byCode.set(code, { code, name, count: rows.length, bytes: Buffer.byteLength(json), updated });
      built++;
      console.log(`${code} ${String(rows.length).padStart(6)} cameras  ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
      // Publish the index every few states so progress is visible even if the job dies later.
      if (kvEnabled && built % 5 === 0) await publishIndex();
    } catch (e) {
      failed.push(code);
      console.error(`${code} failed: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(PAUSE_MS);
  }

  const index = await publishIndex();
  kv.push({ key: 'index', value: JSON.stringify(index) });
  await writeFile(join(outDir, 'kv.json'), JSON.stringify(kv));
  console.log(
    `done: ${built} built, ${failed.length} failed${failed.length ? ` (${failed.join(' ')})` : ''}, ` +
      `${skipped.length} left for next run, ${index.states.length} states published`,
  );
  if (!built) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

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
  for (let attempt = 0; attempt < 5; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`${endpoint} ${res.status}`);
      if (!res.ok) throw new Error(`${endpoint} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      if (body.remark && /runtime error|timed out/i.test(body.remark)) throw new Error(`${endpoint}: ${body.remark}`);
      return body.elements ?? [];
    } catch (e) {
      last = e;
      await sleep(15000 * (attempt + 1));
    }
  }
  throw last;
}

async function main() {
  const [outDir = 'packs-out', ...only] = process.argv.slice(2);
  const codes = only.length ? only.map((c) => c.toUpperCase()) : Object.keys(STATES);
  await mkdir(outDir, { recursive: true });
  const updated = Date.now();
  const index = { updated, states: [] };
  const kv = [];
  const failed = [];

  for (const code of codes) {
    const name = STATES[code];
    if (!name) throw new Error(`Unknown state ${code}`);
    try {
      const rows = toRows(await overpass(stateQuery(code)));
      const json = JSON.stringify({ code, name, updated, count: rows.length, cameras: rows });
      await writeFile(join(outDir, `${code}.json`), json);
      kv.push({ key: `pack:${code}`, value: json });
      index.states.push({ code, name, count: rows.length, bytes: Buffer.byteLength(json) });
      console.log(`${code} ${String(rows.length).padStart(6)} cameras  ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
    } catch (e) {
      failed.push(code);
      console.error(`${code} failed: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(PAUSE_MS);
  }

  index.states.sort((a, b) => a.name.localeCompare(b.name));
  if (index.states.length) {
    // A failed state keeps whatever pack KV already has; the index lists only fresh ones plus
    // a note of the failures so the app can still show the older copy.
    index.failed = failed;
    kv.push({ key: 'index', value: JSON.stringify(index) });
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index));
  await writeFile(join(outDir, 'kv.json'), JSON.stringify(kv));
  console.log(`done: ${index.states.length} packs, ${failed.length} failed${failed.length ? ` (${failed.join(' ')})` : ''}`);
  if (!index.states.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

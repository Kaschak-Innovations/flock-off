/**
 * Flock Off report worker.
 *
 * Anonymous, time-limited reports shared between nearby drivers. Two kinds:
 *   trap    "speed trap here"    lives ~2 hours, extended by confirmations
 *   camera  "plate reader here"  lives ~14 days: an unverified sighting that warns other drivers
 *                                 long before an OpenStreetMap mapper verifies and tags it
 *
 *   POST /reports              { kind, lat, lon, heading?, device_id }    -> create, or merge into a live one nearby
 *   GET  /reports?lat&lon&radius_km[&kind]                                -> live reports near a point
 *   POST /reports/:id/vote     { vote: "still" | "gone", device_id }      -> extend or retire a report
 *   GET  /privacy                                                         -> the privacy policy page
 *   GET  /packs, /packs/:state                                            -> trip-pack index, one state's cameras (KV)
 *   GET  /health                                                          -> { ok, signing, now }
 *   (/traps… routes are aliases kept for older app builds)
 *
 * Abuse controls, in layers:
 *   1. Edge rate limits per client IP (WRITE_LIMIT / READ_LIMIT bindings), before any database work.
 *   2. Request signing: when REPORT_KEY is set, every POST must carry X-Flock-Ts and X-Flock-Sig,
 *      an HMAC-SHA256 over "<ts>.<method>.<path>.<body>", within a 5-minute window. The key ships
 *      inside the app, so this stops scripts, not a determined attacker who decompiles the build.
 *   3. Per-install limits in D1 (one report per two minutes, ten per hour, one vote per report).
 *   The next step up is device attestation (Play Integrity / App Attest); see README.
 *
 * Privacy: the app sends a random per-install UUID purely for rate limiting and one-vote-per-install.
 * It is hashed before storage; the worker never sees or stores anything that identifies a person,
 * and it never stores the reporter's own position, only the spot they reported.
 */

import privacyHtml from '../../docs/privacy-policy.html';

type Kind = 'trap' | 'camera';

type ReportRow = {
  id: string;
  kind: Kind;
  lat: number;
  lon: number;
  heading: number | null;
  reported_at: number;
  expires_at: number;
  confirms: number;
  gone: number;
};

type PublicReport = Omit<ReportRow, 'gone'>;

const MAX_QUERY_RADIUS_KM = 50;
const REPORT_BURST_WINDOW_MS = 2 * 60 * 1000;
const REPORT_BURST_MAX = 1;
const REPORT_HOUR_MAX = 10;
const GONE_VOTES_TO_RETIRE = 3;
const LIST_LIMIT = 500;
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 4096;
const PRIVACY_CONTACT_IN_FILE = 'https://github.com/Kaschak-Innovations/flock-off';

const EARTH_RADIUS_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bbox(lat: number, lon: number, radiusM: number) {
  const dLat = radiusM / EARTH_RADIUS_M;
  const dLon = dLat / Math.max(Math.cos(toRad(lat)), 0.01);
  return { south: lat - toDeg(dLat), north: lat + toDeg(dLat), west: lon - toDeg(dLon), east: lon + toDeg(dLon) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function bad(message: string, status = 400): Response {
  return json({ error: message }, status);
}

type Policy = { ttlMs: number; extendMs: number; maxLifeMs: number; mergeRadiusM: number };

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Per-kind lifetimes and merge distance, from wrangler vars with sane fallbacks. */
function policyFor(env: Env, kind: Kind): Policy {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  if (kind === 'camera') {
    return {
      ttlMs: num(env.CAMERA_TTL_DAYS, 14) * DAY,
      extendMs: num(env.CAMERA_CONFIRM_EXTEND_DAYS, 7) * DAY,
      maxLifeMs: num(env.CAMERA_MAX_LIFE_DAYS, 60) * DAY,
      mergeRadiusM: num(env.CAMERA_MERGE_RADIUS_M, 60),
    };
  }
  return {
    ttlMs: num(env.TRAP_TTL_MINUTES, 120) * MIN,
    extendMs: num(env.CONFIRM_EXTEND_MINUTES, 45) * MIN,
    maxLifeMs: num(env.MAX_LIFE_MINUTES, 360) * MIN,
    mergeRadiusM: num(env.MERGE_RADIUS_M, 150),
  };
}

function isLat(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -90 && n <= 90;
}
function isLon(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= -180 && n <= 180;
}
function isKind(k: unknown): k is Kind {
  return k === 'trap' || k === 'camera';
}

async function hashDevice(deviceId: unknown): Promise<string | null> {
  if (typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 128) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`flockoff:${deviceId}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------- abuse controls */

/**
 * Rate-limit key for a request. IPv4 clients are keyed by address. IPv6 subscribers normally hold a
 * whole /64, so keying on the full address would let one phone rotate through 2^64 "clients";
 * the prefix is the honest unit. Mobile carriers put thousands of phones behind one IPv4 address
 * (carrier-grade NAT), which is why the limits in wrangler.jsonc are sized for floods, not people.
 */
function clientKey(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.padStart(4, '0')).join(':')}::/64`;
}

/** Edge rate limit by client IP. Fails open if the binding is missing (local dev without it). */
async function withinLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch {
    return true;
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify the app's request signature. Returns null when valid, or the reason it was rejected.
 * The comparison is done by WebCrypto's verify, which is constant-time.
 */
async function verifySignature(request: Request, path: string, body: string, key: string): Promise<string | null> {
  const ts = request.headers.get('x-flock-ts');
  const sig = request.headers.get('x-flock-sig');
  if (!ts || !sig) return 'Missing signature';
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > SIGNATURE_WINDOW_MS) return 'Stale signature';
  if (!/^[0-9a-f]{64}$/i.test(sig)) return 'Malformed signature';
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const message = new TextEncoder().encode(`${ts}.${request.method.toUpperCase()}.${path}.${body}`);
  const sigBytes = Uint8Array.from(sig.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const ok = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, message);
  return ok ? null : 'Bad signature';
}

/** Read a small JSON body once, keeping the raw text for signature verification. */
async function readBody(request: Request): Promise<{ raw: string; data: Record<string, unknown> } | null> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    return data && typeof data === 'object' ? { raw, data: data as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

function toPublic(row: ReportRow): PublicReport {
  const { gone: _gone, ...rest } = row;
  return rest;
}

const SELECT = 'SELECT id, kind, lat, lon, heading, reported_at, expires_at, confirms, gone FROM traps';

/* ------------------------------------------------------------------ handlers */

async function listReports(url: URL, env: Env): Promise<Response> {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const radiusKm = Math.min(MAX_QUERY_RADIUS_KM, Math.max(0.5, Number(url.searchParams.get('radius_km') ?? '15') || 15));
  if (!isLat(lat) || !isLon(lon)) return bad('lat and lon are required');
  const kindFilter = url.searchParams.get('kind');
  if (kindFilter != null && !isKind(kindFilter)) return bad("kind must be 'trap' or 'camera'");

  const now = Date.now();
  const b = bbox(lat, lon, radiusKm * 1000);
  const { results } = await env.DB.prepare(
    `${SELECT} WHERE expires_at > ?1 AND lat BETWEEN ?2 AND ?3 AND lon BETWEEN ?4 AND ?5
     ${kindFilter ? 'AND kind = ?6' : ''} ORDER BY reported_at DESC LIMIT ${LIST_LIMIT}`,
  )
    .bind(...(kindFilter ? [now, b.south, b.north, b.west, b.east, kindFilter] : [now, b.south, b.north, b.west, b.east]))
    .all<ReportRow>();

  const reports = results.filter((r) => haversineM(lat, lon, r.lat, r.lon) <= radiusKm * 1000).map(toPublic);
  // `traps` is kept for app builds that predate report kinds.
  return json({ reports, traps: reports.filter((r) => r.kind === 'trap'), now });
}

async function createReport(body: Record<string, unknown>, env: Env, defaultKind: Kind): Promise<Response> {
  const { lat, lon } = body;
  if (!isLat(lat) || !isLon(lon)) return bad('lat and lon are required');
  if (body.kind !== undefined && !isKind(body.kind)) return bad("kind must be 'trap' or 'camera'");
  const kind: Kind = isKind(body.kind) ? body.kind : defaultKind;
  const heading = typeof body.heading === 'number' && Number.isFinite(body.heading) ? ((body.heading % 360) + 360) % 360 : null;
  const device = await hashDevice(body.device_id);
  if (!device) return bad('device_id is required');

  const now = Date.now();

  // Per-install limit: one report per two minutes, ten per hour.
  const burst = await env.DB.prepare('SELECT COUNT(*) AS n FROM report_log WHERE device = ?1 AND created_at > ?2')
    .bind(device, now - REPORT_BURST_WINDOW_MS)
    .first<{ n: number }>();
  if ((burst?.n ?? 0) >= REPORT_BURST_MAX) return bad('Slow down: one report every two minutes', 429);
  const hourly = await env.DB.prepare('SELECT COUNT(*) AS n FROM report_log WHERE device = ?1 AND created_at > ?2')
    .bind(device, now - 60 * 60 * 1000)
    .first<{ n: number }>();
  if ((hourly?.n ?? 0) >= REPORT_HOUR_MAX) return bad('Hourly report limit reached', 429);

  const policy = policyFor(env, kind);

  // A report next to a live one of the same kind is a confirmation, not a duplicate pin.
  const b = bbox(lat, lon, policy.mergeRadiusM);
  const { results: nearby } = await env.DB.prepare(
    `${SELECT} WHERE expires_at > ?1 AND kind = ?2 AND lat BETWEEN ?3 AND ?4 AND lon BETWEEN ?5 AND ?6`,
  )
    .bind(now, kind, b.south, b.north, b.west, b.east)
    .all<ReportRow>();
  const existing = nearby.find((r) => haversineM(lat, lon, r.lat, r.lon) <= policy.mergeRadiusM);

  if (existing) {
    const expiresAt = Math.min(existing.reported_at + policy.maxLifeMs, Math.max(existing.expires_at, now + policy.extendMs));
    await env.DB.batch([
      env.DB.prepare('UPDATE traps SET confirms = confirms + 1, expires_at = ?2 WHERE id = ?1').bind(existing.id, expiresAt),
      env.DB.prepare(
        `INSERT INTO votes (trap_id, device, vote, created_at) VALUES (?1, ?2, 'still', ?3)
         ON CONFLICT(trap_id, device) DO UPDATE SET vote = 'still', created_at = excluded.created_at`,
      ).bind(existing.id, device, now),
      env.DB.prepare('INSERT INTO report_log (device, created_at) VALUES (?1, ?2)').bind(device, now),
    ]);
    console.log(JSON.stringify({ message: 'report merged', kind, id: existing.id }));
    return json({ id: existing.id, kind, expires_at: expiresAt, merged: true });
  }

  const id = crypto.randomUUID();
  const expiresAt = now + policy.ttlMs;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO traps (id, kind, lat, lon, heading, reported_at, expires_at, confirms, gone, reporter)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 0, ?8)`,
    ).bind(id, kind, lat, lon, heading, now, expiresAt, device),
    env.DB.prepare(`INSERT INTO votes (trap_id, device, vote, created_at) VALUES (?1, ?2, 'still', ?3)`).bind(id, device, now),
    env.DB.prepare('INSERT INTO report_log (device, created_at) VALUES (?1, ?2)').bind(device, now),
  ]);
  console.log(JSON.stringify({ message: 'report created', kind, id }));
  return json({ id, kind, expires_at: expiresAt, merged: false }, 201);
}

async function voteReport(id: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  const vote = body.vote;
  if (vote !== 'still' && vote !== 'gone') return bad("vote must be 'still' or 'gone'");
  const device = await hashDevice(body.device_id);
  if (!device) return bad('device_id is required');

  const now = Date.now();
  const report = await env.DB.prepare(`${SELECT} WHERE id = ?1`).bind(id).first<ReportRow>();
  if (!report) return bad('Unknown report', 404);
  const policy = policyFor(env, report.kind);

  const previous = await env.DB.prepare('SELECT vote FROM votes WHERE trap_id = ?1 AND device = ?2')
    .bind(id, device)
    .first<{ vote: string }>();

  let confirms = report.confirms;
  let gone = report.gone;
  if (previous?.vote !== vote) {
    if (previous?.vote === 'still') confirms = Math.max(0, confirms - 1);
    if (previous?.vote === 'gone') gone = Math.max(0, gone - 1);
    if (vote === 'still') confirms += 1;
    else gone += 1;
  }

  let expiresAt = report.expires_at;
  if (vote === 'still' && previous?.vote !== 'still') {
    expiresAt = Math.min(report.reported_at + policy.maxLifeMs, Math.max(expiresAt, now + policy.extendMs));
  }
  if (gone >= GONE_VOTES_TO_RETIRE && gone > confirms) {
    expiresAt = Math.min(expiresAt, now);
  }

  await env.DB.batch([
    env.DB.prepare('UPDATE traps SET confirms = ?2, gone = ?3, expires_at = ?4 WHERE id = ?1').bind(id, confirms, gone, expiresAt),
    env.DB.prepare(
      `INSERT INTO votes (trap_id, device, vote, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(trap_id, device) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at`,
    ).bind(id, device, vote, now),
  ]);

  return json({ id, kind: report.kind, expires_at: expiresAt, confirms, gone, active: expiresAt > now });
}

async function sweep(env: Env): Promise<void> {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const results = await env.DB.batch([
    env.DB.prepare('DELETE FROM votes WHERE trap_id IN (SELECT id FROM traps WHERE expires_at < ?1)').bind(dayAgo),
    env.DB.prepare('DELETE FROM traps WHERE expires_at < ?1').bind(dayAgo),
    env.DB.prepare('DELETE FROM report_log WHERE created_at < ?1').bind(dayAgo),
  ]);
  console.log(JSON.stringify({ message: 'sweep', changes: results.map((r) => r.meta.changes) }));
}

/** Trip packs: prebuilt per-state camera lists. Public OpenStreetMap data, so no signature needed. */
async function packs(path: string, env: Env): Promise<Response> {
  const code = path === '/packs' ? null : path.slice('/packs/'.length).toUpperCase();
  if (code !== null && !/^[A-Z]{2}$/.test(code)) return bad('Unknown state', 404);
  const value = await env.PACKS.get(code ? `pack:${code}` : 'index', { cacheTtl: 3600 });
  if (!value) return bad(code ? 'No pack for that state yet' : 'Packs have not been built yet', 404);
  return new Response(value, {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}

function privacyPage(env: Env): Response {
  const contact = env.CONTACT?.trim() || PRIVACY_CONTACT_IN_FILE;
  const href = contact.includes('@') && !contact.startsWith('http') ? `mailto:${contact}` : contact;
  const html = privacyHtml
    .replaceAll(`href="${PRIVACY_CONTACT_IN_FILE}"`, `href="${href}"`)
    .replaceAll(`>${PRIVACY_CONTACT_IN_FILE}<`, `>${contact}<`);
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}

/* ------------------------------------------------------------------ export */

const ID = '([0-9a-fA-F-]{36})';
const VOTE_ROUTE = new RegExp(`^/(reports|traps)/${ID}/vote$`);

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const ip = clientKey(request);

    try {
      if (request.method === 'GET') {
        if (path === '/health') return json({ ok: true, signing: Boolean(env.REPORT_KEY), now: Date.now() });
        if (path === '/privacy') return privacyPage(env);
        if (path === '/') return Response.redirect(new URL('/privacy', url).toString(), 302);
        if (path === '/reports' || path === '/traps') {
          if (!(await withinLimit(env.READ_LIMIT, ip))) return bad('Too many requests', 429);
          return await listReports(url, env);
        }
        if (path === '/packs' || path.startsWith('/packs/')) {
          if (!(await withinLimit(env.READ_LIMIT, ip))) return bad('Too many requests', 429);
          return await packs(path, env);
        }
        return bad('Not found', 404);
      }

      if (request.method === 'POST') {
        const vote = path.match(VOTE_ROUTE);
        const isCreate = path === '/reports' || path === '/traps';
        if (!isCreate && !vote) return bad('Not found', 404);

        if (!(await withinLimit(env.WRITE_LIMIT, ip))) return bad('Too many requests', 429);
        const body = await readBody(request);
        if (!body) return bad('JSON body required');
        if (env.REPORT_KEY) {
          const problem = await verifySignature(request, path, body.raw, env.REPORT_KEY);
          if (problem) return bad(problem, 401);
        }
        if (vote) return await voteReport(vote[2], body.data, env);
        return await createReport(body.data, env, 'trap');
      }

      return bad('Method not allowed', 405);
    } catch (e) {
      console.error(JSON.stringify({ message: 'request failed', path, error: e instanceof Error ? e.message : String(e) }));
      return bad('Internal error', 500);
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(sweep(env));
  },
} satisfies ExportedHandler<Env>;

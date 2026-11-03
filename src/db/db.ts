import * as SQLite from 'expo-sqlite';

import { DB_NAME } from '@/config';
import { bboxAround, haversineM } from '@/geo/geo';
import type { AlertRow, CameraRow, LimitDropRow, ReportRow, Target, TargetKind, TrapRow } from '@/types';
import { labelForKind } from '@/types';

/**
 * One SQLite database shared by the UI and the background tasks.
 * Background tasks can run in a fresh JS context, so nothing here relies on in-memory state:
 * cooldowns, sync bookkeeping and cached data all live in the database.
 */

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      direction REAL,
      manufacturer TEXT,
      operator TEXT,
      tags TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cameras_latlon ON cameras (lat, lon);
    CREATE TABLE IF NOT EXISTS traps (
      id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      heading REAL,
      reported_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirms INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'remote'
    );
    CREATE INDEX IF NOT EXISTS idx_traps_latlon ON traps (lat, lon);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      heading REAL,
      created_at INTEGER NOT NULL,
      submitted INTEGER NOT NULL DEFAULT 0,
      remote_id TEXT,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      distance_m REAL NOT NULL,
      fired_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_target ON alerts (target_id, fired_at);
    CREATE TABLE IF NOT EXISTS limit_drops (
      id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      from_mph INTEGER NOT NULL,
      to_mph INTEGER NOT NULL,
      heading REAL NOT NULL,
      road TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_limit_drops_latlon ON limit_drops (lat, lon);
    CREATE TABLE IF NOT EXISTS roads (
      target_id TEXT PRIMARY KEY,
      road TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
  const alertCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(alerts)');
  if (!alertCols.some((c) => c.name === 'seen_at')) {
    await db.execAsync('ALTER TABLE alerts ADD COLUMN seen_at INTEGER');
  }
  // Trip packs (Pro) tag the cameras they bring in, so a pack can be removed again.
  const camCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(cameras)');
  if (!camCols.some((c) => c.name === 'pack')) {
    await db.execAsync('ALTER TABLE cameras ADD COLUMN pack TEXT');
  }
  // Installs created before live camera reports existed lack the kind column.
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(traps)');
  if (!cols.some((c) => c.name === 'kind')) {
    await db.execAsync("ALTER TABLE traps ADD COLUMN kind TEXT NOT NULL DEFAULT 'trap'");
  }
}

/* ------------------------------------------------------------------ meta */

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export async function getMetaNumber(key: string): Promise<number | null> {
  const raw = await getMeta(key);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/* --------------------------------------------------------------- cameras */

export async function upsertCameras(rows: CameraRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      `INSERT INTO cameras (id, kind, lat, lon, direction, manufacturer, operator, tags, updated_at, pack)
       VALUES ($id, $kind, $lat, $lon, $direction, $manufacturer, $operator, $tags, $updated_at, $pack)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, lat = excluded.lat, lon = excluded.lon, direction = excluded.direction,
         manufacturer = excluded.manufacturer, operator = excluded.operator, tags = excluded.tags,
         updated_at = MAX(excluded.updated_at, cameras.updated_at), pack = COALESCE(excluded.pack, cameras.pack)`,
    );
    try {
      for (const r of rows) {
        await stmt.executeAsync({
          $id: r.id,
          $kind: r.kind,
          $lat: r.lat,
          $lon: r.lon,
          $direction: r.direction,
          $manufacturer: r.manufacturer,
          $operator: r.operator,
          $tags: r.tags,
          $updated_at: r.updated_at,
          $pack: r.pack ?? null,
        });
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

/** Drop cameras inside a bbox that were not refreshed by the latest sync (removed from OSM). */
export async function pruneStaleCamerasInBbox(
  bbox: { south: number; west: number; north: number; east: number },
  olderThan: number,
): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'DELETE FROM cameras WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND updated_at < ?',
    bbox.south,
    bbox.north,
    bbox.west,
    bbox.east,
    olderThan,
  );
  return res.changes;
}

export async function countCameras(): Promise<{ alpr: number; speed_camera: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ kind: string; n: number }>(
    'SELECT kind, COUNT(*) AS n FROM cameras GROUP BY kind',
  );
  const out = { alpr: 0, speed_camera: 0 };
  for (const r of rows) {
    if (r.kind === 'alpr') out.alpr = r.n;
    if (r.kind === 'speed_camera') out.speed_camera = r.n;
  }
  return out;
}

export async function getCameraById(id: string): Promise<CameraRow | null> {
  const db = await getDb();
  return db.getFirstAsync<CameraRow>('SELECT * FROM cameras WHERE id = ?', id);
}

export async function getCamerasNear(
  lat: number,
  lon: number,
  radiusKm: number,
  kinds: ('alpr' | 'speed_camera')[],
): Promise<(CameraRow & { distance_m: number })[]> {
  if (kinds.length === 0) return [];
  const db = await getDb();
  const b = bboxAround(lat, lon, radiusKm);
  const placeholders = kinds.map(() => '?').join(',');
  const rows = await db.getAllAsync<CameraRow>(
    `SELECT * FROM cameras WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND kind IN (${placeholders})`,
    b.south,
    b.north,
    b.west,
    b.east,
    ...kinds,
  );
  const radiusM = radiusKm * 1000;
  return rows
    .map((r) => ({ ...r, distance_m: haversineM(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b2) => a.distance_m - b2.distance_m);
}

export async function clearCameras(): Promise<void> {
  const db = await getDb();
  await db.execAsync("DELETE FROM cameras; DELETE FROM meta WHERE key LIKE 'sync_%' OR key LIKE 'pack_%';");
}

/** Remove a trip pack's cameras. Ones near you come back with the next local sync. */
export async function deletePackCameras(code: string): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync('DELETE FROM cameras WHERE pack = ?', code);
  await db.runAsync('DELETE FROM meta WHERE key LIKE ?', `pack_${code}_%`);
  return res.changes;
}

/* ----------------------------------------------------------------- traps */

export async function upsertTraps(rows: TrapRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO traps (id, kind, lat, lon, heading, reported_at, expires_at, confirms, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind, lat = excluded.lat, lon = excluded.lon, heading = excluded.heading,
           expires_at = excluded.expires_at, confirms = excluded.confirms`,
        r.id,
        r.kind,
        r.lat,
        r.lon,
        r.heading,
        r.reported_at,
        r.expires_at,
        r.confirms,
        r.source,
      );
    }
  });
}

export async function pruneExpiredTraps(now = Date.now()): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM traps WHERE expires_at < ?', now);
}

export async function removeTrap(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM traps WHERE id = ?', id);
}

export async function updateTrapStatus(id: string, expiresAt: number, confirms: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE traps SET expires_at = ?, confirms = ? WHERE id = ?', expiresAt, confirms, id);
}

export async function getTrapById(id: string): Promise<TrapRow | null> {
  const db = await getDb();
  return db.getFirstAsync<TrapRow>('SELECT * FROM traps WHERE id = ?', id);
}

export async function getActiveTrapsNear(
  lat: number,
  lon: number,
  radiusKm: number,
  now = Date.now(),
): Promise<(TrapRow & { distance_m: number })[]> {
  const db = await getDb();
  const b = bboxAround(lat, lon, radiusKm);
  const rows = await db.getAllAsync<TrapRow>(
    'SELECT * FROM traps WHERE expires_at >= ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?',
    now,
    b.south,
    b.north,
    b.west,
    b.east,
  );
  const radiusM = radiusKm * 1000;
  return rows
    .map((r) => ({ ...r, distance_m: haversineM(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b2) => a.distance_m - b2.distance_m);
}

/* --------------------------------------------------------------- targets */

export function cameraToTarget(c: CameraRow): Target {
  return {
    id: c.id,
    kind: c.kind,
    lat: c.lat,
    lon: c.lon,
    direction: c.direction,
    label: c.kind === 'alpr' ? labelForKind('alpr') : labelForKind('speed_camera'),
    manufacturer: c.manufacturer,
    operator: c.operator,
  };
}

export function trapToTarget(t: TrapRow): Target {
  const kind = t.kind === 'camera' ? 'camera_report' : 'trap';
  return {
    id: t.id,
    kind,
    lat: t.lat,
    lon: t.lon,
    direction: t.heading,
    label: labelForKind(kind),
    expiresAt: t.expires_at,
    confirms: t.confirms,
    reportedAt: t.reported_at,
  };
}

export function limitDropToTarget(d: LimitDropRow): Target {
  return {
    id: d.id,
    kind: 'limit_drop',
    lat: d.lat,
    lon: d.lon,
    direction: d.heading,
    label: labelForKind('limit_drop'),
    fromMph: d.from_mph,
    toMph: d.to_mph,
    road: d.road,
  };
}

/** Resolve a geofence identifier back to the thing it was registered for. */
export async function getTargetById(id: string): Promise<Target | null> {
  if (id.startsWith('osm-')) {
    const c = await getCameraById(id);
    return c ? cameraToTarget(c) : null;
  }
  if (id.startsWith('ld-')) {
    const db = await getDb();
    const d = await db.getFirstAsync<LimitDropRow>('SELECT * FROM limit_drops WHERE id = ?', id);
    return d ? limitDropToTarget(d) : null;
  }
  const t = await getTrapById(id);
  return t ? trapToTarget(t) : null;
}

/* ----------------------------------------------------------- limit drops */

export async function upsertLimitDrops(rows: LimitDropRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      `INSERT INTO limit_drops (id, lat, lon, from_mph, to_mph, heading, road, updated_at)
       VALUES ($id, $lat, $lon, $from, $to, $heading, $road, $updated_at)
       ON CONFLICT(id) DO UPDATE SET
         lat = excluded.lat, lon = excluded.lon, from_mph = excluded.from_mph, to_mph = excluded.to_mph,
         heading = excluded.heading, road = excluded.road, updated_at = excluded.updated_at`,
    );
    try {
      for (const r of rows) {
        await stmt.executeAsync({
          $id: r.id,
          $lat: r.lat,
          $lon: r.lon,
          $from: r.from_mph,
          $to: r.to_mph,
          $heading: r.heading,
          $road: r.road,
          $updated_at: r.updated_at,
        });
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

export async function pruneStaleLimitDropsInBbox(
  bbox: { south: number; west: number; north: number; east: number },
  olderThan: number,
): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'DELETE FROM limit_drops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND updated_at < ?',
    bbox.south,
    bbox.north,
    bbox.west,
    bbox.east,
    olderThan,
  );
  return res.changes;
}

export async function getLimitDropsNear(
  lat: number,
  lon: number,
  radiusKm: number,
  minDropMph: number,
): Promise<(LimitDropRow & { distance_m: number })[]> {
  const db = await getDb();
  const b = bboxAround(lat, lon, radiusKm);
  const rows = await db.getAllAsync<LimitDropRow>(
    'SELECT * FROM limit_drops WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND (from_mph - to_mph) >= ?',
    b.south,
    b.north,
    b.west,
    b.east,
    minDropMph,
  );
  const radiusM = radiusKm * 1000;
  return rows
    .map((r) => ({ ...r, distance_m: haversineM(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b2) => a.distance_m - b2.distance_m);
}

export async function countLimitDrops(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM limit_drops');
  return row?.n ?? 0;
}

export async function clearLimitDrops(): Promise<void> {
  const db = await getDb();
  await db.execAsync("DELETE FROM limit_drops; DELETE FROM meta WHERE key LIKE 'limits_%';");
}

/* --------------------------------------------------------------- reports */

export async function insertReport(row: ReportRow): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO reports (id, kind, lat, lon, heading, created_at, submitted, remote_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.kind,
    row.lat,
    row.lon,
    row.heading,
    row.created_at,
    row.submitted,
    row.remote_id,
    row.note,
  );
}

export async function markReportSubmitted(id: string, remoteId: string | null, note: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE reports SET submitted = 1, remote_id = ?, note = ? WHERE id = ?', remoteId, note, id);
}

export async function listReports(limit = 50): Promise<ReportRow[]> {
  const db = await getDb();
  return db.getAllAsync<ReportRow>('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?', limit);
}

/* ---------------------------------------------------------------- alerts */

/** True when this target fired an alert within the cooldown window. */
export async function alertedRecently(targetId: string, cooldownMs: number, now = Date.now()): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM alerts WHERE target_id = ? AND fired_at > ?',
    targetId,
    now - cooldownMs,
  );
  return (row?.n ?? 0) > 0;
}

export async function logAlert(target: Target, distanceM: number, now = Date.now()): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO alerts (target_id, kind, lat, lon, distance_m, fired_at) VALUES (?, ?, ?, ?, ?, ?)',
    target.id,
    target.kind,
    target.lat,
    target.lon,
    distanceM,
    now,
  );
  // Keep the table small; this is a log, not an archive.
  await db.runAsync(
    'DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY fired_at DESC LIMIT 500)',
  );
}

export async function recentAlerts(limit = 20): Promise<AlertRow[]> {
  const db = await getDb();
  return db.getAllAsync<AlertRow>('SELECT * FROM alerts ORDER BY fired_at DESC LIMIT ?', limit);
}

export async function unreadAlertCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM alerts WHERE seen_at IS NULL');
  return row?.n ?? 0;
}

export async function markAlertsSeen(ids?: number[]): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  if (!ids) {
    await db.runAsync('UPDATE alerts SET seen_at = ? WHERE seen_at IS NULL', now);
    return;
  }
  if (ids.length === 0) return;
  await db.runAsync(`UPDATE alerts SET seen_at = ? WHERE seen_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`, now, ...ids);
}

/* ----------------------------------------------------------------- roads */

/** Cached street name for a target, from a best-effort reverse geocode. */
export async function getCachedRoad(targetId: string): Promise<string | null | undefined> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ road: string | null }>('SELECT road FROM roads WHERE target_id = ?', targetId);
  return row ? row.road : undefined;
}

export async function setCachedRoad(targetId: string, road: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO roads (target_id, road, updated_at) VALUES (?, ?, ?) ON CONFLICT(target_id) DO UPDATE SET road = excluded.road, updated_at = excluded.updated_at',
    targetId,
    road,
    Date.now(),
  );
}

export type { TargetKind };

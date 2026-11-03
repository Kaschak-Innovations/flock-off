import {
  LIMITS_MAX_AGE_MS,
  LIMITS_MIN_STORED_DROP_MPH,
  LIMITS_RADIUS_KM,
  LIMITS_RESYNC_DISTANCE_KM,
  LIMIT_HIGHWAY_CLASSES,
  OVERPASS_ENDPOINTS,
  USER_AGENT,
} from '@/config';
import { getMetaNumber, pruneStaleLimitDropsInBbox, setMeta, upsertLimitDrops } from '@/db/db';
import { angleDiff, bboxAround, bearingDeg, haversineM, type BBox } from '@/geo/geo';
import type { LimitDropRow } from '@/types';

/**
 * Speed-limit drops. OpenStreetMap splits a road into a new way wherever the posted limit
 * changes, so a drop is a node shared by two ways whose maxspeed differs. We keep the point,
 * the two limits, and the direction of travel INTO the lower limit, so the alert only fires
 * for drivers heading that way. Speed traps live at exactly these points.
 */

type OverpassWay = {
  type: 'way';
  id: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
};

type ParsedWay = { id: number; mph: number; nodes: number[]; geom: { lat: number; lon: number }[]; name: string | null };

const MPH_PER_KMH = 0.621371;

/** "35 mph" → 35, "50" → 31 (km/h), "none"/"signals"/"walk" → null. */
export function parseMaxspeedMph(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value || value === 'none' || value === 'signals' || value === 'variable' || value === 'walk') return null;
  const first = value.split(/[;|]/)[0].trim();
  const m = first.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|knots)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? 'km/h';
  if (unit === 'mph') return Math.round(n);
  if (unit === 'knots') return Math.round(n * 1.15078);
  return Math.round(n * MPH_PER_KMH);
}

export function buildLimitsQuery(b: BBox): string {
  const box = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
  return `[out:json][timeout:120];
way["maxspeed"]["highway"~"^(${LIMIT_HIGHWAY_CLASSES.join('|')})$"](${box});
out tags geom qt;`;
}

/**
 * Turn a set of ways into drop points. Only endpoint-to-endpoint joins count (that is how OSM
 * models a limit change on one road); a way merely passing through a junction node is skipped,
 * as is a join where the next way heads off at an angle (a turn onto a side street, not a drop).
 */
export function computeLimitDrops(ways: OverpassWay[], now: number): LimitDropRow[] {
  const parsed: ParsedWay[] = [];
  for (const w of ways) {
    const mph = parseMaxspeedMph(w.tags?.maxspeed);
    if (mph == null || !w.nodes || !w.geometry || w.nodes.length < 2 || w.geometry.length !== w.nodes.length) continue;
    parsed.push({ id: w.id, mph, nodes: w.nodes, geom: w.geometry, name: w.tags?.name ?? w.tags?.ref ?? null });
  }

  type End = { way: ParsedWay; atStart: boolean };
  const ends = new Map<number, End[]>();
  for (const way of parsed) {
    const first = way.nodes[0];
    const last = way.nodes[way.nodes.length - 1];
    if (first === last) continue; // closed loop
    ends.set(first, [...(ends.get(first) ?? []), { way, atStart: true }]);
    ends.set(last, [...(ends.get(last) ?? []), { way, atStart: false }]);
  }

  const out: LimitDropRow[] = [];
  for (const [node, list] of ends) {
    if (list.length < 2 || list.length > 4) continue;
    for (const a of list) {
      for (const b of list) {
        if (a === b || a.way.id === b.way.id) continue;
        const drop = a.way.mph - b.way.mph;
        if (drop < LIMITS_MIN_STORED_DROP_MPH) continue;

        // Travel along A toward the shared node.
        const aGeom = a.way.geom;
        const aPrev = a.atStart ? aGeom[1] : aGeom[aGeom.length - 2];
        const shared = a.atStart ? aGeom[0] : aGeom[aGeom.length - 1];
        const heading = bearingDeg(aPrev.lat, aPrev.lon, shared.lat, shared.lon);

        // B must continue roughly straight on.
        const bGeom = b.way.geom;
        const bNext = b.atStart ? bGeom[1] : bGeom[bGeom.length - 2];
        const departure = bearingDeg(shared.lat, shared.lon, bNext.lat, bNext.lon);
        if (angleDiff(heading, departure) > 80) continue;

        out.push({
          id: `ld-${node}-${a.way.id}-${b.way.id}`,
          lat: shared.lat,
          lon: shared.lon,
          from_mph: a.way.mph,
          to_mph: b.way.mph,
          heading,
          road: b.way.name ?? a.way.name,
          updated_at: now,
        });
      }
    }
  }
  return out;
}

async function fetchOverpass(query: string): Promise<{ elements: OverpassWay[] }> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${endpoint} responded ${res.status}`);
      return (await res.json()) as { elements: OverpassWay[] };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Overpass endpoints failed');
}

export type LimitsSyncResult = { skipped: boolean; drops: number; ways: number };

/** Refresh the limit-drop cache around a position. Limits change rarely, so this is lazy. */
export async function syncLimitsAround(lat: number, lon: number, opts: { force?: boolean } = {}): Promise<LimitsSyncResult> {
  const now = Date.now();
  const lastLat = await getMetaNumber('limits_lat');
  const lastLon = await getMetaNumber('limits_lon');
  const lastAt = await getMetaNumber('limits_at');
  if (!opts.force && lastLat != null && lastLon != null && lastAt != null) {
    const movedKm = haversineM(lat, lon, lastLat, lastLon) / 1000;
    if (movedKm < LIMITS_RESYNC_DISTANCE_KM && now - lastAt < LIMITS_MAX_AGE_MS) {
      return { skipped: true, drops: 0, ways: 0 };
    }
  }

  const bbox = bboxAround(lat, lon, LIMITS_RADIUS_KM);
  const data = await fetchOverpass(buildLimitsQuery(bbox));
  const ways = data.elements.filter((e) => e.type === 'way');
  const drops = computeLimitDrops(ways, now);
  await upsertLimitDrops(drops);
  await pruneStaleLimitDropsInBbox(bbox, now);

  await setMeta('limits_lat', String(lat));
  await setMeta('limits_lon', String(lon));
  await setMeta('limits_at', String(now));
  await setMeta('limits_count', String(drops.length));
  return { skipped: false, drops: drops.length, ways: ways.length };
}

export async function getLimitsSyncInfo(): Promise<{ at: number | null; count: number | null }> {
  return { at: await getMetaNumber('limits_at'), count: await getMetaNumber('limits_count') };
}

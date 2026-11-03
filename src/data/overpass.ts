import {
  OVERPASS_ENDPOINTS,
  RESYNC_DISTANCE_KM,
  SYNC_MAX_AGE_MS,
  SYNC_RADIUS_KM,
  USER_AGENT,
} from '@/config';
import { getMeta, getMetaNumber, pruneStaleCamerasInBbox, setMeta, upsertCameras } from '@/db/db';
import { bboxAround, haversineM, parseDirection, type BBox } from '@/geo/geo';
import type { CameraRow } from '@/types';

/**
 * Camera data comes from OpenStreetMap, where the DeFlock community tags each reader as
 *   man_made=surveillance + surveillance:type=ALPR (+ manufacturer=Flock Safety, direction=...)
 * and fixed enforcement cameras as highway=speed_camera.
 * We pull everything in a ~40 km box around the user and keep it in SQLite, so alerts work
 * offline and the background tasks never wait on the network.
 */

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = { elements: OverpassElement[] };

export function buildOverpassQuery(b: BBox): string {
  const box = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
  return `[out:json][timeout:90];
(
  node["man_made"="surveillance"]["surveillance:type"="ALPR"](${box});
  way["man_made"="surveillance"]["surveillance:type"="ALPR"](${box});
  node["highway"="speed_camera"](${box});
);
out body center;`;
}

export function elementToCamera(el: OverpassElement, now: number): CameraRow | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const kind: CameraRow['kind'] =
    tags['surveillance:type'] === 'ALPR' ? 'alpr' : tags.highway === 'speed_camera' ? 'speed_camera' : 'alpr';
  return {
    id: `osm-${el.type[0]}${el.id}`,
    kind,
    lat,
    lon,
    direction: parseDirection(tags.direction ?? tags['camera:direction']),
    manufacturer: tags.manufacturer ?? tags.brand ?? null,
    operator: tags.operator ?? null,
    tags: JSON.stringify(tags),
    updated_at: now,
  };
}

async function fetchOverpass(query: string): Promise<OverpassResponse> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${endpoint} responded ${res.status}`);
      return (await res.json()) as OverpassResponse;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Overpass endpoints failed');
}

export type SyncResult = { skipped: boolean; added: number; removed: number; center: { lat: number; lon: number } };

/**
 * Refresh the local camera cache around a position. Cheap to call often: it returns early
 * unless the user has moved RESYNC_DISTANCE_KM from the last sync center or the data is a day old.
 */
export async function syncAround(lat: number, lon: number, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const now = Date.now();
  const lastLat = await getMetaNumber('sync_lat');
  const lastLon = await getMetaNumber('sync_lon');
  const lastAt = await getMetaNumber('sync_at');

  if (!opts.force && lastLat != null && lastLon != null && lastAt != null) {
    const movedKm = haversineM(lat, lon, lastLat, lastLon) / 1000;
    const ageOk = now - lastAt < SYNC_MAX_AGE_MS;
    if (movedKm < RESYNC_DISTANCE_KM && ageOk) {
      return { skipped: true, added: 0, removed: 0, center: { lat: lastLat, lon: lastLon } };
    }
  }

  const bbox = bboxAround(lat, lon, SYNC_RADIUS_KM);
  const data = await fetchOverpass(buildOverpassQuery(bbox));
  const rows: CameraRow[] = [];
  for (const el of data.elements) {
    const row = elementToCamera(el, now);
    if (row) rows.push(row);
  }
  await upsertCameras(rows);
  // Anything inside the box that this sync did not touch has been deleted upstream.
  const removed = await pruneStaleCamerasInBbox(bbox, now);

  await setMeta('sync_lat', String(lat));
  await setMeta('sync_lon', String(lon));
  await setMeta('sync_at', String(now));
  await setMeta('sync_count', String(rows.length));

  return { skipped: false, added: rows.length, removed, center: { lat, lon } };
}

export async function getSyncInfo(): Promise<{ at: number | null; count: number | null; lat: number | null; lon: number | null }> {
  return {
    at: await getMetaNumber('sync_at'),
    count: await getMetaNumber('sync_count'),
    lat: await getMetaNumber('sync_lat'),
    lon: await getMetaNumber('sync_lon'),
  };
}

export async function hasEverSynced(): Promise<boolean> {
  return (await getMeta('sync_at')) != null;
}

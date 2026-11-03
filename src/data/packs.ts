import { REPORT_SERVER_URL } from '@/config';
import { deletePackCameras, getMetaNumber, setMeta, upsertCameras } from '@/db/db';
import { parseDirection } from '@/geo/geo';
import type { CameraRow } from '@/types';

/**
 * Trip packs (Pro): every mapped plate reader and speed camera in a US state, downloaded ahead of
 * a road trip so alerts keep working with no signal. The worker serves packs built nightly from
 * OpenStreetMap (scripts/build-packs.mjs); downloaded cameras go into the same cache as the local
 * sync, tagged with the state code so a pack can be removed again.
 */

export type PackInfo = { code: string; name: string; count: number; bytes: number };
export type PackIndex = { updated: number; states: PackInfo[] };

type PackRow = [id: string, kind: 'a' | 's', lat: number, lon: number, direction: string | null, manufacturer: string | null];
type PackFile = { code: string; name: string; updated: number; count: number; cameras: PackRow[] };

/** Packs are no older than this before the screen offers an update. */
export const PACK_STALE_MS = 30 * 24 * 60 * 60 * 1000;

function base(): string {
  return REPORT_SERVER_URL.replace(/\/+$/, '');
}

export async function fetchPackIndex(): Promise<PackIndex> {
  const res = await fetch(`${base()}/packs`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error('Trip packs are not available yet. They are built overnight; try again tomorrow.');
  if (!res.ok) throw new Error(`Pack server responded ${res.status}`);
  return (await res.json()) as PackIndex;
}

export function packRowToCamera(r: PackRow, code: string, updated: number): CameraRow {
  const [osmId, kind, lat, lon, direction, manufacturer] = r;
  return {
    id: `osm-${osmId}`,
    kind: kind === 's' ? 'speed_camera' : 'alpr',
    lat,
    lon,
    direction: parseDirection(direction ?? undefined),
    manufacturer,
    operator: null,
    tags: '{}',
    updated_at: updated,
    pack: code,
  };
}

export async function downloadPack(code: string): Promise<InstalledPack> {
  const res = await fetch(`${base()}/packs/${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'No pack for that state yet.' : `Pack server responded ${res.status}`);
  const pack = (await res.json()) as PackFile;
  const rows = pack.cameras.map((r) => packRowToCamera(r, pack.code, pack.updated));
  // Re-downloading replaces the old copy, so cameras deleted upstream disappear too.
  await deletePackCameras(pack.code);
  await upsertCameras(rows);
  const at = Date.now();
  await Promise.all([setMeta(`pack_${pack.code}_at`, String(at)), setMeta(`pack_${pack.code}_count`, String(rows.length))]);
  return { at, count: rows.length };
}

export async function removePack(code: string): Promise<void> {
  await deletePackCameras(code);
}

export type InstalledPack = { at: number; count: number };

export async function installedPacks(codes: string[]): Promise<Record<string, InstalledPack>> {
  const out: Record<string, InstalledPack> = {};
  for (const code of codes) {
    const at = await getMetaNumber(`pack_${code}_at`);
    if (at != null) out[code] = { at, count: (await getMetaNumber(`pack_${code}_count`)) ?? 0 };
  }
  return out;
}

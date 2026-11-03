import { cameraToTarget, getActiveTrapsNear, getCamerasNear, getLimitDropsNear, limitDropToTarget, trapToTarget } from '@/db/db';
import type { Settings } from '@/store/settings';
import type { Target } from '@/types';

export type RankedTarget = Target & { distance_m: number };

/**
 * Everything alert-worthy near a point, nearest first, honoring the user's filters.
 * Fixed cameras come from the OSM cache; live traps from the worker cache. Both are local reads.
 */
export async function loadTargetsNear(
  lat: number,
  lon: number,
  radiusKm: number,
  settings: Settings,
  opts: { forDrive?: boolean } = {},
): Promise<RankedTarget[]> {
  const kinds: ('alpr' | 'speed_camera')[] = [];
  if (settings.includeAlpr) kinds.push('alpr');
  if (settings.includeSpeedCameras) kinds.push('speed_camera');

  const cameras = await getCamerasNear(lat, lon, radiusKm, kinds);
  const out: RankedTarget[] = cameras.map((c) => ({ ...cameraToTarget(c), distance_m: c.distance_m }));

  if (settings.includeLiveTraps || settings.includeCameraReports) {
    const reports = await getActiveTrapsNear(lat, lon, radiusKm);
    for (const t of reports) {
      if (t.kind === 'trap' && !settings.includeLiveTraps) continue;
      if (t.kind === 'camera' && !settings.includeCameraReports) continue;
      out.push({ ...trapToTarget(t), distance_m: t.distance_m });
    }
  }

  // Limit drops only matter while driving, and there are too many of them to spend geofence slots on.
  if (opts.forDrive && settings.includeLimitDrops) {
    const drops = await getLimitDropsNear(lat, lon, radiusKm, settings.limitDropMinMph);
    for (const d of drops) out.push({ ...limitDropToTarget(d), distance_m: d.distance_m });
  }

  out.sort((a, b) => a.distance_m - b.distance_m);
  return out;
}

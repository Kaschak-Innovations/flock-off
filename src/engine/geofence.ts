import * as Location from 'expo-location';

import { fireAlert } from '@/alerts/notify';
import { distanceFactor } from '@/alerts/tuning';
import {
  BUBBLE_ID,
  BUBBLE_MAX_RADIUS_M,
  BUBBLE_MIN_RADIUS_M,
  GEOFENCE_SEARCH_RADIUS_KM,
  MAX_TARGET_REGIONS,
  SENTINEL_ID,
  SENTINEL_RADIUS_M,
  TASKS,
} from '@/config';
import { syncAround } from '@/data/overpass';
import { refreshTrapsNear } from '@/data/traps';
import { getMetaNumber, getTargetById, setMeta } from '@/db/db';
import { loadTargetsNear } from '@/engine/targets';
import { bearingDeg, haversineM, isDirectionRelevant } from '@/geo/geo';
import { handleSentinelExit } from '@/engine/autoDrive';
import { isPro } from '@/pro/pro';
import { getSettings } from '@/store/settings';

/**
 * Idle-mode watcher. The OS can only monitor a handful of circles (20 on iOS, 100 on Android),
 * so we register the nearest targets plus one big "bubble" around the user. Leaving the bubble
 * is the signal to re-center: refresh data if needed, pick the new nearest set, re-register.
 * Calling startGeofencingAsync again replaces the previous region list (per expo-location docs).
 */

export type GeofenceSnapshot = {
  centerLat: number;
  centerLon: number;
  registeredTargets: number;
  bubbleRadiusM: number;
  at: number;
};

export async function isMonitoring(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(TASKS.GEOFENCE);
  } catch {
    return false;
  }
}

export async function stopMonitoring(): Promise<void> {
  if (await isMonitoring()) {
    await Location.stopGeofencingAsync(TASKS.GEOFENCE);
  }
}

/** (Re)build the region set around a position. Safe to call from the background task. */
export async function refreshGeofences(lat: number, lon: number): Promise<GeofenceSnapshot> {
  const settings = await getSettings();

  // Keep the cache fresh if the user has drifted far from the last sync. Network may be
  // unavailable in the background; a failed sync just means we work from the existing cache.
  try {
    await syncAround(lat, lon);
  } catch {
    // ignore
  }
  try {
    await refreshTrapsNear(lat, lon, GEOFENCE_SEARCH_RADIUS_KM);
  } catch {
    // ignore
  }

  const pro = await isPro();
  // Automatic drive mode (Pro) spends one slot on the motion sentinel.
  const sentinel = pro && settings.autoDrive;
  const slots = MAX_TARGET_REGIONS - (sentinel ? 1 : 0);
  const radiusFor = (kind: Parameters<typeof distanceFactor>[2]) => Math.round(settings.geofenceRadiusM * distanceFactor(settings, pro, kind));

  const targets = await loadTargetsNear(lat, lon, GEOFENCE_SEARCH_RADIUS_KM, settings);
  const chosen = targets.slice(0, slots);
  const next = targets[slots];

  // The bubble must be re-centered before the (N+1)th target could matter, so its radius is the
  // distance to that target minus its alert radius, clamped to something sane.
  const bubbleRadiusM = Math.min(
    BUBBLE_MAX_RADIUS_M,
    Math.max(BUBBLE_MIN_RADIUS_M, next ? next.distance_m - radiusFor(next.kind) : BUBBLE_MAX_RADIUS_M),
  );

  const regions: Location.LocationRegion[] = chosen.map((t) => ({
    identifier: t.id,
    latitude: t.lat,
    longitude: t.lon,
    radius: radiusFor(t.kind),
    notifyOnEnter: true,
    notifyOnExit: false,
  }));
  if (sentinel) {
    regions.push({
      identifier: SENTINEL_ID,
      latitude: lat,
      longitude: lon,
      radius: SENTINEL_RADIUS_M,
      notifyOnEnter: false,
      notifyOnExit: true,
    });
  }
  regions.push({
    identifier: BUBBLE_ID,
    latitude: lat,
    longitude: lon,
    radius: bubbleRadiusM,
    notifyOnEnter: false,
    notifyOnExit: true,
  });

  await Location.startGeofencingAsync(TASKS.GEOFENCE, regions);

  const at = Date.now();
  await setMeta('geofence_lat', String(lat));
  await setMeta('geofence_lon', String(lon));
  await setMeta('geofence_at', String(at));
  await setMeta('geofence_count', String(chosen.length));
  await setMeta('geofence_bubble', String(Math.round(bubbleRadiusM)));

  return { centerLat: lat, centerLon: lon, registeredTargets: chosen.length, bubbleRadiusM, at };
}

export async function getGeofenceSnapshot(): Promise<GeofenceSnapshot | null> {
  const centerLat = await getMetaNumber('geofence_lat');
  const centerLon = await getMetaNumber('geofence_lon');
  const at = await getMetaNumber('geofence_at');
  if (centerLat == null || centerLon == null || at == null) return null;
  return {
    centerLat,
    centerLon,
    at,
    registeredTargets: (await getMetaNumber('geofence_count')) ?? 0,
    bubbleRadiusM: (await getMetaNumber('geofence_bubble')) ?? 0,
  };
}

async function bestKnownPosition(): Promise<Location.LocationObject | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 60 * 1000, requiredAccuracy: 200 });
    if (last) return last;
  } catch {
    // ignore
  }
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return null;
  }
}

export type GeofenceTaskData = { eventType: Location.GeofencingEventType; region: Location.LocationRegion };

/** Entry point for the background geofence task. */
export async function handleGeofenceEvent(data: GeofenceTaskData): Promise<void> {
  const { eventType, region } = data;
  const id = region.identifier ?? '';

  if (id === SENTINEL_ID) {
    if (eventType === Location.GeofencingEventType.Exit) await handleSentinelExit();
    return;
  }

  if (id === BUBBLE_ID) {
    if (eventType !== Location.GeofencingEventType.Exit) return;
    const settings = await getSettings();
    if (!settings.monitoringEnabled) return;
    const pos = await bestKnownPosition();
    if (!pos) return;
    await refreshGeofences(pos.coords.latitude, pos.coords.longitude);
    return;
  }

  if (eventType !== Location.GeofencingEventType.Enter) return;

  const target = await getTargetById(id);
  if (!target) return;
  if (target.expiresAt != null && target.expiresAt < Date.now()) return;

  const settings = await getSettings();
  const pos = await bestKnownPosition();
  const heading = pos?.coords.heading ?? null;
  if (settings.directionAware && !isDirectionRelevant(heading, target.direction, settings.directionToleranceDeg)) {
    return;
  }

  const distanceM = pos ? haversineM(pos.coords.latitude, pos.coords.longitude, target.lat, target.lon) : region.radius;
  const bearing = pos ? bearingDeg(pos.coords.latitude, pos.coords.longitude, target.lat, target.lon) : null;
  await fireAlert(target, distanceM, bearing);
}

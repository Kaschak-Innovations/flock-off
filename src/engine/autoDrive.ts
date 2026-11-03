import * as Location from 'expo-location';

import { AUTO_DRIVE_START_MPS } from '@/config';
import { isDriveModeOn, startDriveMode } from '@/engine/driveMode';
import { haversineM } from '@/geo/geo';
import { isPro } from '@/pro/pro';
import { getSettings } from '@/store/settings';

/**
 * Automatic drive mode (Pro). The geofence watcher keeps a small sentinel circle around where
 * the phone is resting. When the phone leaves it, this decides whether that was a car: driving
 * speed starts drive mode; anything slower (a walk, a GPS jump) just re-centers the sentinel.
 */

const SECOND_FIX_DELAY_MS = 8000;

async function fix(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    return null;
  }
}

/**
 * Speed right now, in m/s. Uses the GPS speed when the fix carries one, otherwise two fixes a few
 * seconds apart. Returns null when no position is available.
 */
export async function measureSpeed(): Promise<{ speed: number; lat: number; lon: number } | null> {
  const a = await fix();
  if (!a) return null;
  const reported = a.coords.speed;
  if (reported != null && reported >= 0 && (a.coords.accuracy ?? 99) < 50) {
    return { speed: reported, lat: a.coords.latitude, lon: a.coords.longitude };
  }
  await new Promise((r) => setTimeout(r, SECOND_FIX_DELAY_MS));
  const b = await fix();
  if (!b) return { speed: 0, lat: a.coords.latitude, lon: a.coords.longitude };
  const seconds = Math.max(1, (b.timestamp - a.timestamp) / 1000);
  const meters = haversineM(a.coords.latitude, a.coords.longitude, b.coords.latitude, b.coords.longitude);
  // A distance smaller than the two fixes' combined error is noise, not motion.
  const noise = (a.coords.accuracy ?? 30) + (b.coords.accuracy ?? 30);
  return { speed: meters > noise ? meters / seconds : 0, lat: b.coords.latitude, lon: b.coords.longitude };
}

export async function handleSentinelExit(): Promise<void> {
  const settings = await getSettings();
  if (!settings.monitoringEnabled || !settings.autoDrive || !(await isPro())) return;
  if (await isDriveModeOn()) return;

  const m = await measureSpeed();
  if (!m) return;
  if (m.speed >= AUTO_DRIVE_START_MPS) {
    await startDriveMode({ auto: true });
    return;
  }
  // Not a car. Move the sentinel to where the phone is now. Lazy import: geofence imports this module.
  const { refreshGeofences } = await import('@/engine/geofence');
  await refreshGeofences(m.lat, m.lon);
}

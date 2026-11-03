import * as Location from 'expo-location';

import { clearLiveCountdown, liveCountdownSupported, updateLiveCountdown } from '@/alerts/live';
import { ensureNotificationSetup, fireAlert, roadFor } from '@/alerts/notify';
import { distanceFactor, DISTANCE_FACTOR } from '@/alerts/tuning';
import {
  AUTO_DRIVE_MOVING_MPS,
  AUTO_DRIVE_STOP_MS,
  DRIVE_AHEAD_MAX_ANGLE,
  DRIVE_MOVING_SPEED_MPS,
  DRIVE_RESYNC_CHECK_MS,
  DRIVE_SPEED_LOOKAHEAD_S,
  DRIVE_TICK_MIN_MS,
  DRIVE_TRAP_POLL_MS,
  DRIVE_TRAP_POLL_RADIUS_KM,
  LIMIT_DROP_HEADING_TOLERANCE,
  LIVE_LOOKAHEAD_KM,
  TASKS,
} from '@/config';
import { syncLimitsAround } from '@/data/limits';
import { syncAround } from '@/data/overpass';
import { refreshTrapsNear } from '@/data/traps';
import { getMeta, getMetaNumber, setMeta } from '@/db/db';
import { loadTargetsNear, type RankedTarget } from '@/engine/targets';
import { angleDiff, bearingDeg, formatDistance, isDirectionRelevant } from '@/geo/geo';
import { isPro } from '@/pro/pro';
import { getSettings, type Settings } from '@/store/settings';
import { displayName } from '@/types';

/**
 * Drive mode: continuous GPS with our own distance check. More battery than geofences, but
 * the warning lands ahead of the camera instead of on top of it. On Android this runs as a
 * foreground service (persistent notification); on iOS it uses the Always permission plus the
 * `location` background mode.
 *
 * A session is either manual (the user switched it on) or automatic (Pro: started by the motion
 * sentinel). Automatic sessions end themselves once the car has been parked for a few minutes.
 */

export async function isDriveModeOn(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TASKS.DRIVE);
  } catch {
    return false;
  }
}

export async function isAutoSession(): Promise<boolean> {
  return (await getMeta('drive_auto')) === '1';
}

export async function startDriveMode(opts: { auto?: boolean } = {}): Promise<void> {
  await ensureNotificationSetup();
  const auto = opts.auto ?? false;
  const now = String(Date.now());
  await Promise.all([setMeta('drive_started_at', now), setMeta('drive_last_moving_at', now), setMeta('drive_auto', auto ? '1' : '0')]);
  await Location.startLocationUpdatesAsync(TASKS.DRIVE, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 2000,
    // Automatic sessions need fixes while parked too, or they could never notice the car stopped.
    distanceInterval: auto ? 0 : 20,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: auto ? 'Flock Off started drive mode' : 'Flock Off is watching the road',
      notificationBody: auto ? 'You started driving. It stops on its own after you park.' : 'Drive mode is on. Open the app to turn it off.',
      notificationColor: '#0B0B0D',
      killServiceOnDestroy: false,
    },
  });
}

export async function stopDriveMode(at?: { lat: number; lon: number }): Promise<void> {
  if (await isDriveModeOn()) {
    await Location.stopLocationUpdatesAsync(TASKS.DRIVE);
  }
  await setMeta('drive_auto', '0');
  await clearLiveCountdown();
  await rearmSentinel(at);
}

/**
 * Put the motion sentinel where the phone is now. A geofence only reports an exit after an entry,
 * so a sentinel left behind somewhere along the route would never fire again.
 */
async function rearmSentinel(at?: { lat: number; lon: number }): Promise<void> {
  const settings = await getSettings();
  if (!settings.monitoringEnabled || !settings.autoDrive || !(await isPro())) return;
  let pos = at;
  if (!pos) {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
    if (last) pos = { lat: last.coords.latitude, lon: last.coords.longitude };
  }
  if (!pos) return;
  // Imported lazily: geofence -> autoDrive -> driveMode would otherwise form a cycle at load time.
  const { refreshGeofences } = await import('@/engine/geofence');
  await refreshGeofences(pos.lat, pos.lon).catch(() => {});
}

export type DriveTaskData = { locations: Location.LocationObject[] };

type Ranked = RankedTarget;

/** Is a target worth warning about given where we are heading? Shared by alerts and the countdown. */
function relevant(t: Ranked, lat: number, lon: number, heading: number | null, moving: boolean, settings: Settings): boolean {
  const bearing = bearingDeg(lat, lon, t.lat, t.lon);
  // When moving, ignore things behind us; a camera we already passed is not a warning.
  if (moving && angleDiff(heading!, bearing) > DRIVE_AHEAD_MAX_ANGLE) return false;
  // A limit drop is one-directional by nature: only warn drivers heading into the lower limit.
  if (t.kind === 'limit_drop') {
    if (!moving || t.direction == null || angleDiff(heading!, t.direction) > LIMIT_DROP_HEADING_TOLERANCE) return false;
  }
  if (settings.directionAware && moving && !isDirectionRelevant(heading, t.direction, settings.directionToleranceDeg)) return false;
  return true;
}

/** Entry point for the background location task. Processes the newest fix only. */
export async function handleDriveLocations(data: DriveTaskData): Promise<void> {
  const latest = data.locations[data.locations.length - 1];
  if (!latest) return;

  const now = Date.now();
  const lastTick = (await getMetaNumber('drive_last_tick')) ?? 0;
  if (now - lastTick < DRIVE_TICK_MIN_MS) return;
  await setMeta('drive_last_tick', String(now));

  const { latitude: lat, longitude: lon, heading, speed } = latest.coords;
  const speedMps = speed != null && speed > 0 ? speed : 0;
  const settings = await getSettings();
  const pro = await isPro();

  // Automatic sessions end after the car has been parked for a while.
  if (speedMps >= AUTO_DRIVE_MOVING_MPS) {
    await setMeta('drive_last_moving_at', String(now));
  } else if (await isAutoSession()) {
    const lastMoving = (await getMetaNumber('drive_last_moving_at')) ?? now;
    if (now - lastMoving > AUTO_DRIVE_STOP_MS) {
      await stopDriveMode({ lat, lon });
      return;
    }
  }

  // Housekeeping on a slow cadence: fresh traps every minute, re-check the OSM cache every 5.
  const lastTrapPoll = (await getMetaNumber('drive_last_trap_poll')) ?? 0;
  if (now - lastTrapPoll > DRIVE_TRAP_POLL_MS) {
    await setMeta('drive_last_trap_poll', String(now));
    try {
      await refreshTrapsNear(lat, lon, DRIVE_TRAP_POLL_RADIUS_KM);
    } catch {
      // offline is fine
    }
  }
  const lastSyncCheck = (await getMetaNumber('drive_last_sync_check')) ?? 0;
  if (now - lastSyncCheck > DRIVE_RESYNC_CHECK_MS) {
    await setMeta('drive_last_sync_check', String(now));
    try {
      await syncAround(lat, lon);
    } catch {
      // offline is fine
    }
    if (settings.includeLimitDrops) {
      try {
        await syncLimitsAround(lat, lon);
      } catch {
        // offline is fine
      }
    }
  }

  // Faster = look further ahead. 600 m default; at 30 m/s (67 mph) the lookahead term is 450 m.
  // Pro alert tuning scales the radius per kind (Near / Normal / Early).
  const baseRadiusM = Math.max(settings.driveAlertRadiusM, speedMps * DRIVE_SPEED_LOOKAHEAD_S);
  const maxFactor = pro ? Math.max(...Object.values(settings.kindDistance).map((d) => DISTANCE_FACTOR[d])) : 1;
  const moving = speedMps >= DRIVE_MOVING_SPEED_MPS && heading != null && heading >= 0;
  const live = pro && settings.liveCountdown && liveCountdownSupported;
  const searchKm = Math.max(1, (baseRadiusM * maxFactor) / 1000, live ? LIVE_LOOKAHEAD_KM : 0);

  const targets = await loadTargetsNear(lat, lon, searchKm, settings, { forDrive: true });
  let next: Ranked | null = null;
  for (const t of targets) {
    if (!relevant(t, lat, lon, heading, moving, settings)) continue;
    if (!next) next = t;
    const radiusM = baseRadiusM * distanceFactor(settings, pro, t.kind);
    if (t.distance_m > radiusM) continue;
    await fireAlert(t, t.distance_m, bearingDeg(lat, lon, t.lat, t.lon), { ahead: moving });
  }

  if (live) {
    if (next) {
      const road = next.kind === 'limit_drop' ? next.road ?? null : await roadFor(next);
      await updateLiveCountdown(
        `Next: ${displayName(next)} · ${formatDistance(next.distance_m, settings.units)}`,
        `${moving ? 'Ahead' : 'Nearest'}${road ? ` on ${road}` : ''}`,
      );
    } else {
      await updateLiveCountdown('Road clear', `Nothing mapped ahead within ${formatDistance(LIVE_LOOKAHEAD_KM * 1000, settings.units)}`);
    }
  }
}

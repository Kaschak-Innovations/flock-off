import * as Location from 'expo-location';

import { ensureNotificationSetup, fireAlert } from '@/alerts/notify';
import {
  DRIVE_AHEAD_MAX_ANGLE,
  DRIVE_MOVING_SPEED_MPS,
  DRIVE_RESYNC_CHECK_MS,
  DRIVE_SPEED_LOOKAHEAD_S,
  DRIVE_TICK_MIN_MS,
  DRIVE_TRAP_POLL_MS,
  DRIVE_TRAP_POLL_RADIUS_KM,
  LIMIT_DROP_HEADING_TOLERANCE,
  TASKS,
} from '@/config';
import { syncLimitsAround } from '@/data/limits';
import { syncAround } from '@/data/overpass';
import { refreshTrapsNear } from '@/data/traps';
import { getMetaNumber, setMeta } from '@/db/db';
import { loadTargetsNear } from '@/engine/targets';
import { angleDiff, bearingDeg, isDirectionRelevant } from '@/geo/geo';
import { getSettings } from '@/store/settings';

/**
 * Drive mode: continuous GPS with our own distance check. More battery than geofences, but
 * the warning lands ahead of the camera instead of on top of it. On Android this runs as a
 * foreground service (persistent notification); on iOS it uses the Always permission plus the
 * `location` background mode.
 */

export async function isDriveModeOn(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TASKS.DRIVE);
  } catch {
    return false;
  }
}

export async function startDriveMode(): Promise<void> {
  await ensureNotificationSetup();
  await Location.startLocationUpdatesAsync(TASKS.DRIVE, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 2000,
    distanceInterval: 20,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Flock Off is watching the road',
      notificationBody: 'Drive mode is on. Open the app to turn it off.',
      notificationColor: '#0B0B0D',
      killServiceOnDestroy: false,
    },
  });
  await setMeta('drive_started_at', String(Date.now()));
}

export async function stopDriveMode(): Promise<void> {
  if (await isDriveModeOn()) {
    await Location.stopLocationUpdatesAsync(TASKS.DRIVE);
  }
}

export type DriveTaskData = { locations: Location.LocationObject[] };

/** Entry point for the background location task. Processes the newest fix only. */
export async function handleDriveLocations(data: DriveTaskData): Promise<void> {
  const latest = data.locations[data.locations.length - 1];
  if (!latest) return;

  const now = Date.now();
  const lastTick = (await getMetaNumber('drive_last_tick')) ?? 0;
  if (now - lastTick < DRIVE_TICK_MIN_MS) return;
  await setMeta('drive_last_tick', String(now));

  const { latitude: lat, longitude: lon, heading, speed } = latest.coords;
  const settings = await getSettings();

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
  const speedMps = speed != null && speed > 0 ? speed : 0;
  const radiusM = Math.max(settings.driveAlertRadiusM, speedMps * DRIVE_SPEED_LOOKAHEAD_S);
  const moving = speedMps >= DRIVE_MOVING_SPEED_MPS && heading != null && heading >= 0;

  const targets = await loadTargetsNear(lat, lon, Math.max(1, radiusM / 1000), settings, { forDrive: true });
  for (const t of targets) {
    if (t.distance_m > radiusM) break;
    const bearing = bearingDeg(lat, lon, t.lat, t.lon);
    // When moving, ignore things behind us; a camera we already passed is not a warning.
    if (moving && angleDiff(heading!, bearing) > DRIVE_AHEAD_MAX_ANGLE) continue;
    // A limit drop is one-directional by nature: only warn drivers heading into the lower limit.
    if (t.kind === 'limit_drop') {
      if (!moving || t.direction == null || angleDiff(heading!, t.direction) > LIMIT_DROP_HEADING_TOLERANCE) continue;
    }
    if (settings.directionAware && moving && !isDirectionRelevant(heading, t.direction, settings.directionToleranceDeg)) {
      continue;
    }
    await fireAlert(t, t.distance_m, bearing, { ahead: moving });
  }
}

import * as TaskManager from 'expo-task-manager';

import { TASKS } from '@/config';
import { handleDriveLocations, type DriveTaskData } from '@/engine/driveMode';
import { handleGeofenceEvent, type GeofenceTaskData } from '@/engine/geofence';

/**
 * Background task definitions. This module must be imported at the top of the root layout so
 * the tasks are defined at module scope before the OS wakes the app for an event.
 * (expo-task-manager requires defineTask at module scope, never inside a component.)
 */

TaskManager.defineTask<GeofenceTaskData>(TASKS.GEOFENCE, async ({ data, error }) => {
  if (error) {
    console.warn('[flockoff] geofence task error', error.message);
    return;
  }
  if (!data) return;
  try {
    await handleGeofenceEvent(data);
  } catch (e) {
    console.warn('[flockoff] geofence handler failed', e);
  }
});

TaskManager.defineTask<DriveTaskData>(TASKS.DRIVE, async ({ data, error }) => {
  if (error) {
    console.warn('[flockoff] drive task error', error.message);
    return;
  }
  if (!data) return;
  try {
    await handleDriveLocations(data);
  } catch (e) {
    console.warn('[flockoff] drive handler failed', e);
  }
});

export const TASKS_DEFINED = true;

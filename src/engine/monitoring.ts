import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import { ensureNotificationSetup } from '@/alerts/notify';
import { syncLimitsAround } from '@/data/limits';
import { hasEverSynced, syncAround } from '@/data/overpass';
import { startDriveMode } from '@/engine/driveMode';
import { refreshGeofences, stopMonitoring } from '@/engine/geofence';
import { getSettings, saveSettings } from '@/store/settings';

/**
 * High-level switches used by the UI. These wrap the permission dance, the first data sync,
 * and the geofence registration into one call each.
 */

export type PermissionState = {
  foreground: Location.PermissionStatus;
  background: Location.PermissionStatus;
  notifications: boolean;
  servicesEnabled: boolean;
};

export async function readPermissions(): Promise<PermissionState> {
  const [fg, bg, notif, services] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.getBackgroundPermissionsAsync(),
    Notifications.getPermissionsAsync(),
    Location.hasServicesEnabledAsync().catch(() => false),
  ]);
  return { foreground: fg.status, background: bg.status, notifications: notif.granted, servicesEnabled: services };
}

/**
 * Google Play requires a prominent in-app disclosure before the background-location prompt.
 * True until the user has seen it and tapped Continue, or background access is already granted.
 */
export async function needsDisclosure(): Promise<boolean> {
  const settings = await getSettings();
  if (settings.disclosureAccepted) return false;
  const bg = await Location.getBackgroundPermissionsAsync();
  return bg.status !== 'granted';
}

/**
 * Ask for everything background alerts need, in the order the platforms require:
 * foreground location first, then background ("Always"), then notifications.
 * Returns false if any of them is denied; the UI explains what is missing.
 */
export async function requestAllPermissions(): Promise<{ ok: boolean; state: PermissionState }> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status === 'granted') {
    await Location.requestBackgroundPermissionsAsync();
  }
  await ensureNotificationSetup();
  const state = await readPermissions();
  const ok = state.foreground === 'granted' && state.background === 'granted' && state.notifications;
  return { ok, state };
}

export async function currentPosition(): Promise<Location.LocationObject> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 30 * 1000, requiredAccuracy: 100 }).catch(() => null);
  if (last) return last;
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
}

export type SwitchResult = { ok: boolean; message: string };

function missingMessage(state: PermissionState): string {
  const missing: string[] = [];
  if (state.foreground !== 'granted') missing.push('location');
  if (state.background !== 'granted') missing.push('location set to Always');
  if (!state.notifications) missing.push('notifications');
  return `Still missing: ${missing.join(', ')}. Allow them in system settings and try again.`;
}

export async function enableMonitoring(): Promise<SwitchResult> {
  const { ok, state } = await requestAllPermissions();
  if (!ok) return { ok: false, message: missingMessage(state) };

  const pos = await currentPosition();
  const first = !(await hasEverSynced());
  try {
    await syncAround(pos.coords.latitude, pos.coords.longitude, { force: first });
  } catch (e) {
    if (first) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, message: `Could not download camera data (${msg}). Check your connection and try again.` };
    }
  }

  const snap = await refreshGeofences(pos.coords.latitude, pos.coords.longitude);
  await saveSettings({ monitoringEnabled: true });
  return {
    ok: true,
    message:
      snap.registeredTargets > 0
        ? `Watching the ${snap.registeredTargets} nearest cameras.`
        : 'Monitoring is on. No mapped cameras near you yet; the watcher re-checks as you move.',
  };
}

export async function disableMonitoring(): Promise<void> {
  await stopMonitoring();
  await saveSettings({ monitoringEnabled: false });
}

export async function enableDriveMode(): Promise<SwitchResult> {
  const { ok, state } = await requestAllPermissions();
  if (!ok) return { ok: false, message: missingMessage(state) };
  const pos = await currentPosition();
  try {
    await syncAround(pos.coords.latitude, pos.coords.longitude);
    const settings = await getSettings();
    if (settings.includeLimitDrops) await syncLimitsAround(pos.coords.latitude, pos.coords.longitude);
  } catch {
    // work from cache
  }
  await startDriveMode();
  return { ok: true, message: 'Drive mode is on. Warnings fire ahead of cameras while you move.' };
}

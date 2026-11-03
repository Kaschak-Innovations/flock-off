import { haversineM } from '@/geo/geo';
import type { AlertDistance, AlertSound, Settings } from '@/store/settings';
import type { TargetKind } from '@/types';

/**
 * Pro alert tuning, applied in one place so the geofence watcher, drive mode and the notifier
 * agree. Without Pro every function returns the default behavior.
 */

export const DISTANCE_FACTOR: Record<AlertDistance, number> = { near: 0.6, normal: 1, early: 1.6 };

export const DISTANCE_LABEL: Record<AlertDistance, string> = { near: 'Near', normal: 'Normal', early: 'Early' };
export const SOUND_LABEL: Record<AlertSound, string> = { default: 'Default', chime: 'Chime', pulse: 'Pulse', silent: 'Vibrate' };

export function distanceFactor(settings: Settings, pro: boolean, kind: TargetKind): number {
  return pro ? DISTANCE_FACTOR[settings.kindDistance[kind]] : 1;
}

export function soundFor(settings: Settings, pro: boolean, kind: TargetKind): AlertSound {
  if (!settings.alertSound) return 'silent';
  return pro ? settings.kindSound[kind] : 'default';
}

/** True when local time falls inside the quiet window. Handles windows that span midnight. */
export function inQuietHours(q: Settings['quietHours'], date = new Date()): boolean {
  if (!q.enabled || q.startHour === q.endHour) return false;
  const h = date.getHours();
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour;
}

export function inHomeZone(z: Settings['homeZone'], lat: number, lon: number): boolean {
  if (!z.enabled || z.lat == null || z.lon == null) return false;
  return haversineM(lat, lon, z.lat, z.lon) <= z.radiusM;
}

/** Why an alert should stay quiet, or null to fire it. */
export function suppressionReason(settings: Settings, pro: boolean, lat: number, lon: number, now = new Date()): string | null {
  if (!pro) return null;
  if (inQuietHours(settings.quietHours, now)) return 'quiet-hours';
  if (inHomeZone(settings.homeZone, lat, lon)) return 'home-zone';
  return null;
}

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';

/**
 * User-tunable settings. Stored as one JSON blob in AsyncStorage so the background
 * tasks (which may run in their own JS context) read the same values as the UI.
 */
export type Settings = {
  /** Master switch for the low-power geofence watcher. */
  monitoringEnabled: boolean;
  /** Radius of each camera geofence, meters. Bigger = earlier but vaguer alerts. */
  geofenceRadiusM: number;
  /** Alert radius in drive mode, meters (scaled up with speed). */
  driveAlertRadiusM: number;
  /** Minutes before the same camera may alert again. */
  cooldownMin: number;
  includeAlpr: boolean;
  includeSpeedCameras: boolean;
  includeLiveTraps: boolean;
  /** Unverified camera reports relayed from other drivers through the worker. */
  includeCameraReports: boolean;
  /** Drive-mode warnings where the posted limit falls by limitDropMinMph or more. */
  includeLimitDrops: boolean;
  limitDropMinMph: number;
  /** Skip cameras that face a cross street relative to your heading. */
  directionAware: boolean;
  directionToleranceDeg: number;
  /** Base URL of the deployed Cloudflare Worker, e.g. https://flock-off-traps.yourname.workers.dev */
  trapsApiUrl: string;
  /** Post an anonymous OpenStreetMap note when reporting a camera. */
  submitOsmNotes: boolean;
  alertSound: boolean;
  /** Distance units in alerts and lists. */
  units: 'imperial' | 'metric';
  /** The user saw the background-location disclosure and tapped Continue. */
  disclosureAccepted: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  monitoringEnabled: false,
  geofenceRadiusM: 350,
  driveAlertRadiusM: 600,
  cooldownMin: 10,
  includeAlpr: true,
  includeSpeedCameras: true,
  includeLiveTraps: true,
  includeCameraReports: true,
  includeLimitDrops: true,
  limitDropMinMph: 15,
  directionAware: false,
  directionToleranceDeg: 50,
  trapsApiUrl: '',
  submitOsmNotes: true,
  alertSound: true,
  units: 'imperial',
  disclosureAccepted: false,
};

const SETTINGS_KEY = 'flockoff.settings.v1';
const DEVICE_ID_KEY = 'flockoff.deviceId';

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

/**
 * Random per-install identifier used only for rate limiting and vote de-duplication on the
 * speed-trap worker. It is not tied to the device, the account, or anything else.
 */
export async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>, () => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null);

  const reload = useCallback(async () => {
    setSettings(await getSettings());
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
  }, []);

  return [settings, update, reload];
}

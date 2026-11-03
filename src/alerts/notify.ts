import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationPriority, AndroidNotificationVisibility } from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { attachmentFor } from '@/alerts/icons';
import { ensureLiveChannel } from '@/alerts/live';
import { soundFor, suppressionReason } from '@/alerts/tuning';
import { speak, spokenCopy } from '@/alerts/voice';
import { AlertColors } from '@/constants/theme';
import { alertedRecently, getCachedRoad, logAlert, setCachedRoad } from '@/db/db';
import { cardinalFromBearing, formatDistance, timeAgo } from '@/geo/geo';
import { isPro } from '@/pro/pro';
import { getSettings, type AlertSound } from '@/store/settings';
import { displayName, pinLabel, type Target } from '@/types';

export const ALERT_CHANNEL_ID = 'alerts';

/**
 * Android binds a sound to a channel when the channel is created, so each alert sound gets its
 * own channel. `alerts` keeps the system default sound and is the one existing installs already have.
 */
const SOUND_CHANNELS: Record<AlertSound, { id: string; name: string; sound: string | null }> = {
  default: { id: ALERT_CHANNEL_ID, name: 'Camera alerts', sound: 'default' },
  chime: { id: 'alerts-chime', name: 'Camera alerts (chime)', sound: 'chime.wav' },
  pulse: { id: 'alerts-pulse', name: 'Camera alerts (pulse)', sound: 'pulse.wav' },
  silent: { id: 'alerts-silent', name: 'Camera alerts (vibrate only)', sound: null },
};

/**
 * Deep link into the phone's default map app with a labeled pin on the target.
 * iOS: Apple Maps honors `q` as the pin label when `ll` is given.
 * Android: the geo: intent with q=lat,lon(label) drops a labeled pin in whatever handles maps.
 */
export function mapsUrl(lat: number, lon: number, label: string): string {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (Platform.OS === 'ios') {
    return `maps://?ll=${ll}&q=${encodeURIComponent(label)}`;
  }
  return `geo:${ll}?q=${ll}(${encodeURIComponent(label)})`;
}

/** Web fallback in case no native handler is registered (rare, but Android forks exist). */
export function mapsWebUrl(lat: number, lon: number, label: string): string {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (Platform.OS === 'ios') {
    return `https://maps.apple.com/?ll=${ll}&q=${encodeURIComponent(label)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${ll}`;
}

export async function openInMaps(lat: number, lon: number, label: string): Promise<void> {
  const native = mapsUrl(lat, lon, label);
  try {
    const ok = await Linking.canOpenURL(native);
    if (ok) {
      await Linking.openURL(native);
      return;
    }
  } catch {
    // fall through
  }
  await Linking.openURL(mapsWebUrl(lat, lon, label));
}

/** Call once on app start and before enabling monitoring. Safe to call repeatedly. */
export async function ensureNotificationSetup(): Promise<boolean> {
  if (Platform.OS === 'android') {
    for (const ch of Object.values(SOUND_CHANNELS)) {
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: ch.name,
        description: 'Warnings when you approach a license plate reader, speed camera, reported speed trap or speed-limit drop.',
        importance: AndroidImportance.MAX,
        vibrationPattern: [0, 300, 150, 300],
        lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
        bypassDnd: false,
        sound: ch.sound,
      });
    }
    await ensureLiveChannel();
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return requested.granted;
}

export type AlertPayload = {
  targetId: string;
  kind: Target['kind'];
  lat: number;
  lon: number;
  label: string;
};

/**
 * Best-effort street name for a target, cached per target. Reverse geocoding needs the network
 * and Apple throttles it, so the lookup is capped at 1.5 s and a miss is remembered as null.
 */
export async function roadFor(target: Target): Promise<string | null> {
  if (target.road) return target.road;
  const cached = await getCachedRoad(target.id);
  if (cached !== undefined) return cached;
  let road: string | null = null;
  try {
    const result = await Promise.race([
      Location.reverseGeocodeAsync({ latitude: target.lat, longitude: target.lon }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    const first = Array.isArray(result) ? result[0] : null;
    road = first?.street ?? null;
  } catch {
    road = null;
  }
  await setCachedRoad(target.id, road);
  return road;
}

type Copy = { title: string; body: string };

/** Title = what + how far. Body = one line of context. Built to be read in one glance. */
export async function alertCopy(
  target: Target,
  distanceM: number,
  bearingDegToTarget: number | null,
  ahead: boolean,
  units: 'imperial' | 'metric',
): Promise<Copy> {
  const dist = formatDistance(distanceM, units);
  const dir = bearingDegToTarget != null ? cardinalFromBearing(bearingDegToTarget) : null;
  const road = target.kind === 'limit_drop' ? target.road ?? null : await roadFor(target);

  switch (target.kind) {
    case 'trap': {
      const confirms = target.confirms ?? 1;
      const when = target.reportedAt ? `Reported ${timeAgo(target.reportedAt)}` : 'Reported by a driver';
      return { title: `Speed trap · ${dist}`, body: `${when} · ${confirms} driver${confirms === 1 ? '' : 's'} confirm` };
    }
    case 'camera_report': {
      const when = target.reportedAt ? ` · reported ${timeAgo(target.reportedAt)}` : '';
      return { title: `Possible camera · ${dist}`, body: `Unverified sighting${road ? ` on ${road}` : ''}${when}` };
    }
    case 'limit_drop':
      return {
        title: `Speed limit ${target.toMph} · ${dist}`,
        body: `Drops from ${target.fromMph}${road ? ` on ${road}` : ''}`,
      };
    default: {
      const where = road ? ` on ${road}` : '';
      const body = ahead ? `Ahead${where}${dir && !road ? ` · to the ${dir}` : ''}` : `${dir ? `To the ${dir}` : 'Nearby'}${where}`;
      return { title: `${displayName(target)} · ${dist}`, body };
    }
  }
}

/**
 * Fire an alert for a target unless it alerted within the cooldown window.
 * Returns true when a notification was actually shown.
 */
export async function fireAlert(
  target: Target,
  distanceM: number,
  bearingDegToTarget: number | null,
  opts: { ahead?: boolean } = {},
): Promise<boolean> {
  const settings = await getSettings();
  const cooldownMs = Math.max(1, settings.cooldownMin) * 60 * 1000;
  if (await alertedRecently(target.id, cooldownMs)) return false;

  const pro = await isPro();
  if (suppressionReason(settings, pro, target.lat, target.lon)) return false;

  const ahead = opts.ahead ?? false;
  const { title, body } = await alertCopy(target, distanceM, bearingDegToTarget, ahead, settings.units);
  const payload: AlertPayload = { targetId: target.id, kind: target.kind, lat: target.lat, lon: target.lon, label: pinLabel(target) };
  const attachment = await attachmentFor(target.kind);
  const sound = soundFor(settings, pro, target.kind);
  const channel = SOUND_CHANNELS[sound];

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: payload as unknown as Record<string, unknown>,
      sound: channel.sound ?? undefined,
      priority: AndroidNotificationPriority.MAX,
      color: AlertColors[target.kind],
      interruptionLevel: 'timeSensitive',
      vibrate: [0, 300, 150, 300],
      attachments: attachment ? [attachment] : undefined,
    },
    // null = deliver now. On Android the channel carries importance and sound.
    trigger: Platform.OS === 'android' ? { channelId: channel.id } : null,
  });
  await logAlert(target, distanceM);

  if (pro && settings.voiceAlerts) {
    const road = target.kind === 'limit_drop' ? target.road ?? null : await roadFor(target);
    speak(spokenCopy(target, distanceM, ahead, settings.units, road));
  }
  return true;
}

/** Handle a tap on one of our notifications: open the pin in the system map app. */
export async function handleNotificationResponse(response: Notifications.NotificationResponse | null): Promise<void> {
  if (!response) return;
  const data = response.notification.request.content.data as Partial<AlertPayload> | undefined;
  if (!data || typeof data.lat !== 'number' || typeof data.lon !== 'number') return;
  await openInMaps(data.lat, data.lon, typeof data.label === 'string' ? data.label : 'Flock');
}

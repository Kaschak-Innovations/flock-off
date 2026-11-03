import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { Platform } from 'react-native';

import { getMeta, setMeta } from '@/db/db';

/**
 * Live countdown (Pro, Android). While drive mode runs, one quiet notification shows the next
 * thing ahead and counts the distance down. It is posted on a low-importance channel, so updates
 * never sound, vibrate or pop up; reusing one identifier replaces it in place.
 *
 * iOS would need a Live Activity (a widget extension target), which is a separate piece of work.
 */

export const LIVE_CHANNEL_ID = 'drive-live';
const LIVE_ID = 'flockoff-drive-live';
const MIN_UPDATE_MS = 4000;

export const liveCountdownSupported = Platform.OS === 'android';

export async function ensureLiveChannel(): Promise<void> {
  if (!liveCountdownSupported) return;
  await Notifications.setNotificationChannelAsync(LIVE_CHANNEL_ID, {
    name: 'Drive mode countdown',
    description: 'Distance to the next camera while drive mode is on. Silent.',
    importance: AndroidImportance.LOW,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
    showBadge: false,
    lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
  });
}

/** Post or update the countdown. Skips the update when nothing visible changed or it is too soon. */
export async function updateLiveCountdown(title: string, body: string): Promise<void> {
  if (!liveCountdownSupported) return;
  const text = `${title}\n${body}`;
  const [lastText, lastAt] = await Promise.all([getMeta('live_text'), getMeta('live_at')]);
  const now = Date.now();
  if (text === lastText) return;
  if (lastAt && now - Number(lastAt) < MIN_UPDATE_MS) return;
  await Promise.all([setMeta('live_text', text), setMeta('live_at', String(now))]);
  await Notifications.scheduleNotificationAsync({
    identifier: LIVE_ID,
    content: {
      title,
      body,
      sticky: true,
      autoDismiss: false,
      sound: undefined,
      color: '#22C55E',
      data: { live: true },
    },
    trigger: { channelId: LIVE_CHANNEL_ID },
  });
}

export async function clearLiveCountdown(): Promise<void> {
  if (!liveCountdownSupported) return;
  await setMeta('live_text', '');
  try {
    await Notifications.dismissNotificationAsync(LIVE_ID);
  } catch {
    // not showing
  }
}

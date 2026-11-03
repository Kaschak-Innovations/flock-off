import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';

import { DISTANCE_LABEL, SOUND_LABEL } from '@/alerts/tuning';
import { speak } from '@/alerts/voice';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Group, Notice, NumberField, Row, Screen, ToggleRow, type Tone } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { isMonitoring, refreshGeofences } from '@/engine/geofence';
import { currentPosition } from '@/engine/monitoring';
import { formatDistance } from '@/geo/geo';
import { usePro } from '@/pro/pro';
import { ALERT_KINDS, useSettings, type AlertDistance, type AlertSound, type Settings } from '@/store/settings';
import { labelForKind, type TargetKind } from '@/types';

const PRO_COLOR = '#FFB300';
const DISTANCES: AlertDistance[] = ['near', 'normal', 'early'];
const SOUNDS: AlertSound[] = ['default', 'chime', 'pulse', 'silent'];
const HOME_RADII_M = [800, 1600, 3200];

const KIND_LABEL: Record<TargetKind, string> = {
  alpr: 'Plate readers',
  speed_camera: 'Speed cameras',
  trap: 'Speed traps',
  camera_report: 'Possible cameras',
  limit_drop: 'Speed-limit drops',
};

const SOUND_FILE: Record<AlertSound, string | undefined> = { default: 'default', chime: 'chime.wav', pulse: 'pulse.wav', silent: undefined };
const SOUND_CHANNEL: Record<AlertSound, string> = { default: 'alerts', chime: 'alerts-chime', pulse: 'alerts-pulse', silent: 'alerts-silent' };

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${suffix}`;
}

/** Alert tuning (Pro): per-kind distance and sound, quiet hours, and a quiet zone around home. */
export default function TuningScreen() {
  const pro = usePro();
  const [settings, update] = useSettings();
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [busy, setBusy] = useState(false);

  const header = { title: 'Alert tuning', icon: 'tune' as const, color: PRO_COLOR, status: 'Per alert type', detail: pro ? 'Pro' : 'Needs Pro' };
  if (!settings) return <Screen back="Settings" tabBar={false} header={header} />;

  const locked = !pro;
  const guard = (fn: () => void) => () => (locked ? router.push('/pro') : fn());

  const reapply = async () => {
    if (await isMonitoring()) {
      try {
        const pos = await currentPosition();
        await refreshGeofences(pos.coords.latitude, pos.coords.longitude);
      } catch {
        // the next bubble exit picks it up
      }
    }
  };

  const setKind = async <K extends 'kindDistance' | 'kindSound'>(key: K, kind: TargetKind, value: Settings[K][TargetKind]) => {
    await update({ [key]: { ...settings[key], [kind]: value } } as Partial<Settings>);
    if (key === 'kindDistance') await reapply();
  };

  const preview = async (sound: AlertSound) => {
    await Notifications.scheduleNotificationAsync({
      content: { title: `Sound: ${SOUND_LABEL[sound]}`, body: 'This is how this alert type will sound.', sound: SOUND_FILE[sound] },
      trigger: Platform.OS === 'android' ? { channelId: SOUND_CHANNEL[sound] } : null,
    });
  };

  const setHome = async () => {
    setBusy(true);
    try {
      const pos = await currentPosition();
      await update({ homeZone: { ...settings.homeZone, enabled: true, lat: pos.coords.latitude, lon: pos.coords.longitude } });
      setMessage({ text: 'Home set to where you are now.', tone: 'success' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const q = settings.quietHours;
  const home = settings.homeZone;

  return (
    <Screen back="Settings" tabBar={false} header={header}>
      {locked ? <Notice tone="info">Alert tuning is part of Pro. Without it, every alert uses Normal distance and the default sound.</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {ALERT_KINDS.map((kind) => (
        <Group key={kind} label={KIND_LABEL[kind] ?? labelForKind(kind)}>
          <Row
            label="Warn"
            hint={kind === 'limit_drop' ? 'Drive mode only.' : 'Early fires further out; Near waits until it is close.'}
            right={
              <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                {DISTANCES.map((d) => (
                  <Chip key={d} label={DISTANCE_LABEL[d]} on={settings.kindDistance[kind] === d} onPress={guard(() => setKind('kindDistance', kind, d))} />
                ))}
              </View>
            }
          />
          <Row
            label="Sound"
            last
            right={
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.xs }} style={{ maxWidth: 230 }}>
                {SOUNDS.map((s) => (
                  <Chip
                    key={s}
                    label={SOUND_LABEL[s]}
                    on={settings.kindSound[kind] === s}
                    onPress={guard(() => {
                      setKind('kindSound', kind, s);
                      preview(s);
                    })}
                  />
                ))}
              </ScrollView>
            }
          />
        </Group>
      ))}

      <Group label="Spoken alerts">
        <Row
          label="Test the voice"
          hint="Plays a sample alert out loud."
          icon="speaker"
          onPress={guard(() => speak('Flock camera ahead, 1,000 feet, on Main Street.'))}
          last
        />
      </Group>

      <Group label="Quiet hours">
        <ToggleRow label="Silence alerts overnight" hint="Nothing fires between these hours." value={q.enabled} onValueChange={(v) => (locked ? router.push('/pro') : update({ quietHours: { ...q, enabled: v } }))} />
        <NumberField label="From" hint={hourLabel(q.startHour)} value={q.startHour} min={0} max={23} suffix="h" onCommit={(v) => !locked && update({ quietHours: { ...q, startHour: v } })} />
        <NumberField label="Until" hint={hourLabel(q.endHour)} value={q.endHour} min={0} max={23} suffix="h" onCommit={(v) => !locked && update({ quietHours: { ...q, endHour: v } })} last />
      </Group>

      <Group label="Quiet near home">
        <ToggleRow
          label="No alerts near home"
          hint={home.lat != null ? 'For cameras you already know about.' : 'Set your home spot first.'}
          value={home.enabled && home.lat != null}
          onValueChange={(v) => (locked ? router.push('/pro') : home.lat == null ? setHome() : update({ homeZone: { ...home, enabled: v } }))}
        />
        <Row
          label="Radius"
          right={
            <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
              {HOME_RADII_M.map((r) => (
                <Chip key={r} label={formatDistance(r, settings.units)} on={home.radiusM === r} onPress={guard(() => update({ homeZone: { ...home, radiusM: r } }))} />
              ))}
            </View>
          }
        />
        <View style={{ paddingVertical: Spacing.md }}>
          <Button title={home.lat != null ? 'Move home to here' : 'Set home to here'} icon="home" variant="secondary" onPress={guard(setHome)} busy={busy} />
        </View>
      </Group>

      <ThemedText type="footnote" themeColor="textSecondary">
        Your home spot is stored only on this phone.
      </ThemedText>
    </Screen>
  );
}

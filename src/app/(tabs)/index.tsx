import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Linking, Platform, View } from 'react-native';

import { ALERT_ICON_MODULES } from '@/alerts/icons';
import { fireAlert } from '@/alerts/notify';
import { ThemedText } from '@/components/themed-text';
import { Button, Group, Notice, Pill, Row, Screen, ToggleRow, type Tone } from '@/components/ui';
import { Spacing, TabColors } from '@/constants/theme';
import { getLimitsSyncInfo, syncLimitsAround } from '@/data/limits';
import { getSyncInfo, hasEverSynced, syncAround } from '@/data/overpass';
import { countCameras, countLimitDrops, recentAlerts, unreadAlertCount } from '@/db/db';
import { isDriveModeOn, stopDriveMode } from '@/engine/driveMode';
import { getGeofenceSnapshot, isMonitoring, refreshGeofences, type GeofenceSnapshot } from '@/engine/geofence';
import {
  currentPosition,
  disableMonitoring,
  enableDriveMode,
  enableMonitoring,
  needsDisclosure,
  readPermissions,
  type PermissionState,
} from '@/engine/monitoring';
import { formatDistance, timeAgo } from '@/geo/geo';
import { useSettings } from '@/store/settings';
import { labelForKind, type AlertRow } from '@/types';

function permissionWord(status: string | undefined): string {
  if (!status) return '…';
  if (status === 'granted') return 'Allowed';
  if (status === 'denied') return 'Denied';
  return 'Not asked';
}

export default function StatusScreen() {
  const [settings] = useSettings();
  const [perm, setPerm] = useState<PermissionState | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [drive, setDrive] = useState(false);
  const [snapshot, setSnapshot] = useState<GeofenceSnapshot | null>(null);
  const [sync, setSync] = useState<{ at: number | null; count: number | null }>({ at: null, count: null });
  const [synced, setSynced] = useState(true);
  const [counts, setCounts] = useState({ alpr: 0, speed_camera: 0 });
  const [drops, setDrops] = useState(0);
  const [limitsAt, setLimitsAt] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState<'monitor' | 'drive' | 'sync' | 'test' | 'refresh' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);

  const refresh = useCallback(async () => {
    const [p, m, d, s, si, ever, c, a, ld, li, u] = await Promise.all([
      readPermissions(),
      isMonitoring(),
      isDriveModeOn(),
      getGeofenceSnapshot(),
      getSyncInfo(),
      hasEverSynced(),
      countCameras(),
      recentAlerts(5),
      countLimitDrops(),
      getLimitsSyncInfo(),
      unreadAlertCount(),
    ]);
    setPerm(p);
    setMonitoring(m);
    setDrive(d);
    setSnapshot(s);
    setSync({ at: si.at, count: si.count });
    setSynced(ever);
    setCounts(c);
    setAlerts(a);
    setDrops(ld);
    setLimitsAt(li.at);
    setUnread(u);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const pullToRefresh = async () => {
    setBusy('refresh');
    try {
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const toggleMonitoring = async (on: boolean) => {
    setMessage(null);
    if (on && (await needsDisclosure())) {
      router.push({ pathname: '/disclosure', params: { intent: 'monitor' } });
      return;
    }
    setBusy('monitor');
    try {
      if (on) {
        const result = await enableMonitoring();
        setMessage({ text: result.message, tone: result.ok ? 'success' : 'error' });
      } else {
        await disableMonitoring();
        setMessage({ text: 'Monitoring is off. You will not be warned about cameras.', tone: 'info' });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const toggleDrive = async (on: boolean) => {
    setMessage(null);
    if (on && (await needsDisclosure())) {
      router.push({ pathname: '/disclosure', params: { intent: 'drive' } });
      return;
    }
    setBusy('drive');
    try {
      if (on) {
        const result = await enableDriveMode();
        setMessage({ text: result.message, tone: result.ok ? 'success' : 'error' });
      } else {
        await stopDriveMode();
        setMessage({ text: 'Drive mode is off.', tone: 'info' });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    setMessage(null);
    try {
      const pos = await currentPosition();
      const result = await syncAround(pos.coords.latitude, pos.coords.longitude, { force: true });
      const limits = await syncLimitsAround(pos.coords.latitude, pos.coords.longitude, { force: true });
      if (monitoring) await refreshGeofences(pos.coords.latitude, pos.coords.longitude);
      setMessage({
        text: `Downloaded ${result.added.toLocaleString()} cameras within 25 mi and ${limits.drops.toLocaleString()} speed-limit drops within 9 mi.`,
        tone: 'success',
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const testAlert = async () => {
    setBusy('test');
    setMessage(null);
    try {
      const pos = await currentPosition();
      const fired = await fireAlert(
        {
          id: `test-${Date.now()}`,
          kind: 'alpr',
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          direction: null,
          label: labelForKind('alpr'),
          manufacturer: 'Flock Safety',
        },
        300,
        45,
        { ahead: true },
      );
      setMessage({
        text: fired ? 'Test alert sent. Tap it to check the maps handoff.' : 'Test alert held back by the cooldown.',
        tone: 'info',
      });
      refresh();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const permissionsOk = perm?.foreground === 'granted' && perm?.background === 'granted' && perm?.notifications;
  const slots = Platform.OS === 'ios' ? 19 : 99;
  const units = settings?.units ?? 'imperial';

  return (
    <Screen
      header={{
        title: 'Flock Off',
        icon: 'radar',
        color: TabColors.status,
        status: monitoring ? 'Monitoring on' : 'Monitoring off',
        detail: drive ? 'Drive mode on' : 'Drive mode off',
        unread,
      }}
      refreshing={busy === 'refresh'}
      onRefresh={pullToRefresh}>
      {message ? (
        <Notice tone={message.tone}>{message.text}</Notice>
      ) : !synced ? (
        <Notice tone="info">Turn on Monitoring to allow location and download the cameras around you. Two prompts, then it runs on its own.</Notice>
      ) : null}

      <Group>
        <ToggleRow
          label="Monitoring"
          hint="Low power. Uses the phone's geofences and warns you even with the app closed."
          value={monitoring}
          onValueChange={toggleMonitoring}
          disabled={busy != null}
        />
        <ToggleRow
          label="Drive mode"
          hint="Continuous GPS for earlier warnings. On for a drive, off when you park."
          value={drive}
          onValueChange={toggleDrive}
          disabled={busy != null}
          last
        />
      </Group>

      <Group label="Permissions">
        <Row label="Location while using" right={<Pill tone={perm?.foreground === 'granted' ? 'on' : 'off'}>{permissionWord(perm?.foreground)}</Pill>} />
        <Row label="Location always" right={<Pill tone={perm?.background === 'granted' ? 'on' : 'off'}>{permissionWord(perm?.background)}</Pill>} />
        <Row label="Notifications" right={<Pill tone={perm?.notifications ? 'on' : 'off'}>{perm ? (perm.notifications ? 'Allowed' : 'Denied') : '…'}</Pill>} last={!!permissionsOk || !perm} />
        {perm && !permissionsOk ? (
          <View style={{ paddingVertical: Spacing.md }}>
            <Button title="Open system settings" variant="secondary" icon="open" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}
      </Group>

      <Group label="Camera data">
        <Row label="Plate readers cached" right={<ThemedText type="headline">{counts.alpr.toLocaleString()}</ThemedText>} />
        <Row label="Speed cameras cached" right={<ThemedText type="headline">{counts.speed_camera.toLocaleString()}</ThemedText>} />
        <Row label="Speed-limit drops cached" hint={limitsAt ? `9 mi around you · ${timeAgo(limitsAt)}` : 'Downloads when drive mode starts'} right={<ThemedText type="headline">{drops.toLocaleString()}</ThemedText>} />
        <Row label="Last download" hint="OpenStreetMap, 25 mi around you" right={<ThemedText type="subhead" themeColor="textSecondary">{timeAgo(sync.at)}</ThemedText>} />
        <Row
          label="Geofences in use"
          hint={snapshot ? `Re-centers after ${formatDistance(snapshot.bubbleRadiusM, units)} · set ${timeAgo(snapshot.at)}` : 'Monitoring is off'}
          right={<ThemedText type="headline">{snapshot ? `${snapshot.registeredTargets} of ${slots}` : '—'}</ThemedText>}
        />
        <View style={{ flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button title="Download now" variant="secondary" onPress={syncNow} busy={busy === 'sync'} disabled={busy != null && busy !== 'sync'} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Test alert" variant="secondary" onPress={testAlert} busy={busy === 'test'} disabled={busy != null && busy !== 'test'} />
          </View>
        </View>
      </Group>

      <Group label="Recent alerts">
        {alerts.length === 0 ? (
          <Row label="No alerts yet" hint="Each warning shows up here and under the bell." last />
        ) : (
          alerts.map((a, i) => (
            <Row
              key={a.id}
              label={labelForKind(a.kind)}
              hint={`${formatDistance(a.distance_m, units)} away · ${timeAgo(a.fired_at)}`}
              left={<Image source={ALERT_ICON_MODULES[a.kind]} style={{ width: 40, height: 40 }} resizeMode="contain" accessibilityIgnoresInvertColors />}
              onPress={() => router.push('/notifications')}
              icon="chevron"
              last={i === alerts.length - 1}
            />
          ))
        )}
      </Group>

      <ThemedText type="footnote" themeColor="textSecondary">
        Your location stays on this phone. The only network traffic is downloading public camera data and the reports you choose to send.
      </ThemedText>
    </Screen>
  );
}

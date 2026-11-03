import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';

import { ALERT_ICON_MODULES } from '@/alerts/icons';
import { openInMaps } from '@/alerts/notify';
import { ThemedText } from '@/components/themed-text';
import { Button, Group, Notice, Row, Screen, type Tone } from '@/components/ui';
import { Spacing, TabColors } from '@/constants/theme';
import { osmNoteUrl, reportCameraHere } from '@/data/reports';
import { refreshTrapsNear, reportTrap, trapsEnabled, voteTrap } from '@/data/traps';
import { getActiveTrapsNear, listReports } from '@/db/db';
import { formatDistance } from '@/geo/geo';
import { getSettings, useSettings } from '@/store/settings';
import type { ReportRow, TrapRow } from '@/types';

type Fix = { lat: number; lon: number; heading: number | null; accuracy: number | null; at: number };
type NearbyTrap = TrapRow & { distance_m: number; minsLeft: number };

export default function ReportScreen() {
  const [settings] = useSettings();
  const [fix, setFix] = useState<Fix | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [traps, setTraps] = useState<NearbyTrap[]>([]);
  const [mine, setMine] = useState<ReportRow[]>([]);
  const [trapsOn, setTrapsOn] = useState(false);
  const [osmNotesOn, setOsmNotesOn] = useState(true);

  const getFix = useCallback(async () => {
    setFixBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') throw new Error('Location permission is needed to report a spot.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const f: Fix = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        heading: pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : null,
        accuracy: pos.coords.accuracy,
        at: Date.now(),
      };
      setFix(f);
      return f;
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
      return null;
    } finally {
      setFixBusy(false);
    }
  }, []);

  const loadLists = useCallback(async (f: Fix | null) => {
    const s = await getSettings();
    setOsmNotesOn(s.submitOsmNotes);
    setTrapsOn(await trapsEnabled());
    setMine(await listReports(10));
    if (f) {
      try {
        await refreshTrapsNear(f.lat, f.lon, 15);
      } catch {
        // offline: show whatever is cached
      }
      const now = Date.now();
      const rows = await getActiveTrapsNear(f.lat, f.lon, 15);
      setTraps(rows.map((t) => ({ ...t, minsLeft: Math.max(0, Math.round((t.expires_at - now) / 60000)) })));
    }
  }, []);

  const reload = useCallback(async () => {
    const f = await getFix();
    await loadLists(f);
  }, [getFix, loadLists]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const submitCamera = async () => {
    setBusy('camera');
    setMessage(null);
    try {
      const f = (await getFix()) ?? fix;
      if (!f) return;
      const result = await reportCameraHere(f.lat, f.lon, f.heading, f.accuracy);
      const relayed = result.relay && !result.relay.offline;
      const relayText = relayed
        ? result.relay?.merged
          ? ' Nearby drivers already had this one; your report confirmed it.'
          : ' Nearby drivers will be warned about it starting now.'
        : result.relay?.offline
          ? ' The report server was unreachable, so other drivers will not see it yet.'
          : '';
      if (result.noteSubmitted) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMessage({ text: `Saved and posted as an OpenStreetMap note for mappers to verify.${relayText}`, tone: 'success' });
      } else if (result.error) {
        setMessage({ text: `Saved on this phone. The OpenStreetMap note did not go through: ${result.error}${relayText}`, tone: 'warn' });
      } else {
        setMessage({ text: `Saved on this phone.${relayText} Turn on OpenStreetMap notes in Settings to feed the shared map too.`, tone: relayed ? 'success' : 'info' });
      }
      await loadLists(f);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const submitTrap = async () => {
    setBusy('trap');
    setMessage(null);
    try {
      const f = (await getFix()) ?? fix;
      if (!f) return;
      const result = await reportTrap(f.lat, f.lon, f.heading);
      if (result.offline) {
        setMessage({ text: 'No connection to the report server. Saved on this phone only, for the next 2 hours.', tone: 'warn' });
      } else if (result.merged) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMessage({ text: 'Someone already reported this spot. Your report confirmed it and kept it alive.', tone: 'success' });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setMessage({ text: 'Speed trap reported. Drivers nearby will be warned for the next 2 hours.', tone: 'success' });
      }
      await loadLists(f);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const vote = async (id: string, v: 'still' | 'gone') => {
    setBusy(id);
    try {
      await voteTrap(id, v);
      await loadLists(fix);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const units = settings?.units ?? 'imperial';
  const accuracy = fix?.accuracy != null ? formatDistance(fix.accuracy, units) : null;
  const fixLabel = fix
    ? `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}${fix.heading != null ? ` · heading ${Math.round(fix.heading)}°` : ''}`
    : 'Getting a GPS fix…';

  return (
    <Screen
      header={{
        title: 'Report',
        icon: 'pin',
        color: TabColors.report,
        status: fix ? 'GPS locked' : 'Locating…',
        detail: accuracy ? `Within ${accuracy}` : undefined,
      }}
      refreshing={fixBusy && busy == null}
      onRefresh={reload}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Group>
        <Row label="Your position" hint={fixLabel} last right={<Button title="Refresh" variant="secondary" compact haptic="none" onPress={getFix} busy={fixBusy} />} />
      </Group>

      <View style={{ gap: Spacing.sm }}>
        <Button title="Flock camera here" icon="camera" haptic="medium" onPress={submitCamera} busy={busy === 'camera'} disabled={busy != null && busy !== 'camera'} />
        <ThemedText type="footnote" themeColor="textSecondary">
          Stand as close to the pole as is safe. Saves the fix on your phone{trapsOn ? ', warns nearby drivers for two weeks' : ''}{osmNotesOn ? ', and posts an anonymous OpenStreetMap note for mappers to verify' : ''}.
        </ThemedText>
      </View>
      <View style={{ gap: Spacing.sm }}>
        <Button title="Speed trap here" icon="speed" variant="outline" haptic="medium" onPress={submitTrap} busy={busy === 'trap'} disabled={busy != null && busy !== 'trap'} />
        <ThemedText type="footnote" themeColor="textSecondary">
          {trapsOn
            ? 'Shared with nearby drivers for 2 hours, longer when others confirm it. Anonymous: only the spot and the time are sent.'
            : 'Sharing is off until a report server URL is set in Settings. Reports still warn you on this phone.'}
        </ThemedText>
      </View>

      <Group label="Live reports nearby">
        {traps.length === 0 ? (
          <Row label="None within 9 mi" hint="Speed traps and unverified cameras reported by other drivers show up here while they are live." last />
        ) : (
          traps.map((t, i) => (
            <Row
              key={t.id}
              label={`${t.kind === 'camera' ? 'Possible camera' : 'Speed trap'} · ${formatDistance(t.distance_m, units)}`}
              hint={`${t.confirms} confirm${t.confirms === 1 ? '' : 's'} · ${t.minsLeft >= 180 ? `${Math.round(t.minsLeft / 1440)} d left` : `${t.minsLeft} min left`}${t.source === 'mine' ? ' · yours' : ''}`}
              left={<Image source={ALERT_ICON_MODULES[t.kind === 'camera' ? 'camera_report' : 'trap']} style={styles.icon} resizeMode="contain" accessibilityIgnoresInvertColors />}
              onPress={() => openInMaps(t.lat, t.lon, t.kind === 'camera' ? 'Possible camera' : 'Speed trap')}
              accessibilityLabel={`${t.kind === 'camera' ? 'Possible camera' : 'Speed trap'} ${formatDistance(t.distance_m, units)} away. Opens in maps.`}
              last={i === traps.length - 1}
              right={
                <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                  <Button title="Still there" variant="secondary" compact onPress={() => vote(t.id, 'still')} busy={busy === t.id} />
                  <Button title="Gone" variant="secondary" compact onPress={() => vote(t.id, 'gone')} disabled={busy === t.id} />
                </View>
              }
            />
          ))
        )}
      </Group>

      <Group label="Your reports">
        {mine.length === 0 ? (
          <Row label="No reports yet" hint="Cameras you report are listed here with their OpenStreetMap note." last />
        ) : (
          mine.map((r, i) => (
            <Row
              key={r.id}
              label={r.kind === 'alpr' ? 'Camera report' : 'Speed trap report'}
              hint={`${new Date(r.created_at).toLocaleString()} · ${r.submitted ? 'OpenStreetMap note posted' : 'saved on this phone'}`}
              icon="open"
              onPress={r.remote_id ? () => Linking.openURL(osmNoteUrl(r.remote_id!)) : () => openInMaps(r.lat, r.lon, 'Reported camera')}
              last={i === mine.length - 1}
            />
          ))
        )}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40 },
});

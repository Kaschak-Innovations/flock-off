import Constants from 'expo-constants';
import { useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Group, Notice, NumberField, Row, Screen, TextField, ToggleRow, type Tone } from '@/components/ui';
import { PRIVACY_URL, PROJECT_URL } from '@/config';
import { Spacing, TabColors } from '@/constants/theme';
import { syncLimitsAround } from '@/data/limits';
import { syncAround } from '@/data/overpass';
import { clearCameras, clearLimitDrops } from '@/db/db';
import { isMonitoring, refreshGeofences } from '@/engine/geofence';
import { currentPosition } from '@/engine/monitoring';
import { useSettings } from '@/store/settings';

export default function SettingsScreen() {
  const [settings, update] = useSettings();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);

  const version = Constants.expoConfig?.version ?? '0.0.0';
  const header = { title: 'Settings', icon: 'gear' as const, color: TabColors.settings, status: 'Alerts and sharing', detail: `Version ${version}` };

  if (!settings) {
    return <Screen header={header} />;
  }

  const reapply = async () => {
    // Filters changed: rebuild the geofence set if monitoring is on.
    if (await isMonitoring()) {
      try {
        const pos = await currentPosition();
        await refreshGeofences(pos.coords.latitude, pos.coords.longitude);
      } catch {
        // the next bubble exit will pick it up
      }
    }
  };

  const set = async <K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) => {
    await update({ [key]: value });
    if (['includeAlpr', 'includeSpeedCameras', 'includeLiveTraps', 'includeCameraReports', 'geofenceRadiusM'].includes(key as string)) {
      await reapply();
    }
  };

  const redownload = async () => {
    setBusy('redownload');
    setMessage(null);
    try {
      await clearCameras();
      await clearLimitDrops();
      const pos = await currentPosition();
      const r = await syncAround(pos.coords.latitude, pos.coords.longitude, { force: true });
      const l = await syncLimitsAround(pos.coords.latitude, pos.coords.longitude, { force: true });
      await reapply();
      setMessage({ text: `Cache rebuilt with ${r.added.toLocaleString()} cameras and ${l.drops.toLocaleString()} speed-limit drops.`, tone: 'success' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const imperial = settings.units === 'imperial';

  return (
    <Screen header={header}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Group label="Warn me about">
        <ToggleRow label="Plate readers" hint="Flock Safety and other ALPR cameras mapped in OpenStreetMap." value={settings.includeAlpr} onValueChange={(v) => set('includeAlpr', v)} />
        <ToggleRow label="Fixed speed cameras" hint="Speed and red-light cameras mapped in OpenStreetMap." value={settings.includeSpeedCameras} onValueChange={(v) => set('includeSpeedCameras', v)} />
        <ToggleRow label="Live speed traps" hint="Time-limited reports from other drivers." value={settings.includeLiveTraps} onValueChange={(v) => set('includeLiveTraps', v)} />
        <ToggleRow label="Possible cameras" hint="Unverified sightings from other drivers, kept two weeks unless voted gone." value={settings.includeCameraReports} onValueChange={(v) => set('includeCameraReports', v)} />
        <ToggleRow label="Speed-limit drops" hint="Drive mode only. Warns where the posted limit falls, which is where traps sit." value={settings.includeLimitDrops} onValueChange={(v) => set('includeLimitDrops', v)} />
        <NumberField label="Minimum drop" hint="Ignore smaller limit changes." value={settings.limitDropMinMph} min={5} max={40} suffix="mph" onCommit={(v) => set('limitDropMinMph', v)} last />
      </Group>

      <Group label="Alerts">
        <Row
          label="Distances"
          hint={imperial ? 'Feet under a quarter mile, then miles.' : 'Meters under a kilometer, then kilometers.'}
          right={
            <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
              <Chip label="ft / mi" on={imperial} onPress={() => set('units', 'imperial')} />
              <Chip label="m / km" on={!imperial} onPress={() => set('units', 'metric')} />
            </View>
          }
        />
        <NumberField label="Geofence radius" hint="Monitoring mode. Larger warns earlier but less precisely." value={settings.geofenceRadiusM} min={100} max={2000} suffix="m" onCommit={(v) => set('geofenceRadiusM', v)} />
        <NumberField label="Drive mode radius" hint="Minimum warning distance. Grows with your speed." value={settings.driveAlertRadiusM} min={150} max={3000} suffix="m" onCommit={(v) => set('driveAlertRadiusM', v)} />
        <NumberField label="Cooldown" hint="The same camera stays quiet for this long after a warning." value={settings.cooldownMin} min={1} max={120} suffix="min" onCommit={(v) => set('cooldownMin', v)} />
        <ToggleRow label="Sound" value={settings.alertSound} onValueChange={(v) => set('alertSound', v)} last />
      </Group>

      <Group label="Direction filter">
        <ToggleRow
          label="Skip cameras facing a cross street"
          hint="Compares the camera's mapped direction with your heading. Cameras without a direction always warn. Experimental."
          value={settings.directionAware}
          onValueChange={(v) => set('directionAware', v)}
        />
        <NumberField label="Tolerance" hint="Degrees either side of parallel that still count as your road." value={settings.directionToleranceDeg} min={10} max={90} suffix="°" onCommit={(v) => set('directionToleranceDeg', v)} last />
      </Group>

      <Group label="Sharing">
        <TextField
          label="Report server"
          hint="Your deployed worker URL. Leave empty to keep reports on this phone."
          value={settings.trapsApiUrl}
          placeholder="https://flock-off-traps.example.workers.dev"
          onCommit={(v) => set('trapsApiUrl', v)}
        />
        <ToggleRow
          label="Post camera reports as OpenStreetMap notes"
          hint="An anonymous note at the spot so mappers can verify and tag it. Position and heading only."
          value={settings.submitOsmNotes}
          onValueChange={(v) => set('submitOsmNotes', v)}
          last
        />
      </Group>

      <Group label="Data and privacy">
        <Row label="Privacy policy" hint="What the app collects and what never leaves your phone." icon="open" onPress={() => Linking.openURL(PRIVACY_URL)} />
        <Row label="Project page" hint="Source, issues and the camera tagging guide." icon="open" onPress={() => Linking.openURL(PROJECT_URL)} />
        <Row label="deflock.me" hint="The community map this app's camera data comes from." icon="open" onPress={() => Linking.openURL('https://deflock.me')} />
        <View style={{ paddingVertical: Spacing.md }}>
          <Button title="Clear cache and download again" variant="secondary" onPress={redownload} busy={busy === 'redownload'} />
        </View>
      </Group>

      <ThemedText type="footnote" themeColor="textSecondary">
        Flock Off {version} · {Platform.OS === 'ios' ? 'iOS' : 'Android'}. Camera data © OpenStreetMap contributors, ODbL. Not affiliated with Flock Safety. Awareness only; it does not interfere with any camera or system.
      </ThemedText>
    </Screen>
  );
}

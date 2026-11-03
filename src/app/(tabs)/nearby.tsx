import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, StyleSheet } from 'react-native';

import { ALERT_ICON_MODULES } from '@/alerts/icons';
import { openInMaps } from '@/alerts/notify';
import { ThemedText } from '@/components/themed-text';
import { Button, EmptyState, Group, Notice, Row, Screen } from '@/components/ui';
import { TabColors } from '@/constants/theme';
import { syncAround } from '@/data/overpass';
import { currentPosition } from '@/engine/monitoring';
import { loadTargetsNear, type RankedTarget } from '@/engine/targets';
import { bearingDeg, cardinalFromBearing, formatDistance, timeAgo } from '@/geo/geo';
import { getSettings, useSettings } from '@/store/settings';
import { displayName, pinLabel } from '@/types';

const LIST_RADIUS_KM = 50;
const LIST_LIMIT = 60;

function describe(t: RankedTarget, now: number): string {
  if (t.kind === 'alpr') {
    const parts: string[] = [];
    if (t.manufacturer && !/flock/i.test(t.manufacturer)) parts.push(t.manufacturer);
    if (t.operator) parts.push(t.operator);
    parts.push(t.direction != null ? `faces ${cardinalFromBearing(t.direction)}` : 'direction not mapped');
    return parts.join(' · ');
  }
  if (t.kind === 'speed_camera') {
    return t.operator ? `Fixed camera · ${t.operator}` : 'Fixed camera';
  }
  if (t.kind === 'camera_report') {
    const age = t.reportedAt ? ` · reported ${timeAgo(t.reportedAt, now)}` : '';
    const confirms = t.confirms ? ` · ${t.confirms} confirm${t.confirms === 1 ? '' : 's'}` : '';
    return `Unverified${age}${confirms}`;
  }
  const mins = t.expiresAt ? Math.max(0, Math.round((t.expiresAt - now) / 60000)) : null;
  return mins != null ? `Reported by a driver · ${mins} min left` : 'Reported by a driver';
}

export default function NearbyScreen() {
  const [settings] = useSettings();
  const [items, setItems] = useState<RankedTarget[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'load' | 'download' | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    setError(null);
    try {
      const pos = await currentPosition();
      const s = await getSettings();
      const all = await loadTargetsNear(pos.coords.latitude, pos.coords.longitude, LIST_RADIUS_KM, s);
      setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      setLoadedAt(Date.now());
      setItems(all.slice(0, LIST_LIMIT));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const download = async () => {
    setBusy('download');
    setError(null);
    try {
      const pos = await currentPosition();
      await syncAround(pos.coords.latitude, pos.coords.longitude, { force: true });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const units = settings?.units ?? 'imperial';
  const radiusLabel = formatDistance(LIST_RADIUS_KM * 1000, units);

  return (
    <Screen
      header={{
        title: 'Nearby',
        icon: 'list',
        color: TabColors.nearby,
        status: items.length > 0 ? `${items.length} within ${radiusLabel}` : 'Nothing cached',
        detail: loadedAt ? `Updated ${timeAgo(loadedAt)}` : undefined,
      }}
      refreshing={busy === 'load'}
      onRefresh={load}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {items.length > 0 ? (
        <ThemedText type="subhead" themeColor="textSecondary">
          Closest first. Tap one to open it in your maps app.
        </ThemedText>
      ) : null}

      <Group>
        {items.length === 0 && busy !== 'load' ? (
          <EmptyState
            title="Nothing cached yet"
            body="Download the cameras within 25 miles of you once; after that the list and the alerts work offline."
            action={<Button title="Download cameras near me" onPress={download} busy={busy === 'download'} />}
          />
        ) : (
          items.map((t, i) => {
            const bearing = origin ? bearingDeg(origin.lat, origin.lon, t.lat, t.lon) : null;
            return (
              <Row
                key={t.id}
                label={displayName(t)}
                hint={describe(t, loadedAt)}
                left={<Image source={ALERT_ICON_MODULES[t.kind]} style={styles.icon} resizeMode="contain" accessibilityIgnoresInvertColors />}
                onPress={() => openInMaps(t.lat, t.lon, pinLabel(t))}
                accessibilityLabel={`${displayName(t)}, ${formatDistance(t.distance_m, units)} away. Opens in maps.`}
                icon="open"
                last={i === items.length - 1}
                right={
                  <ThemedText type="headline" style={styles.distance}>
                    {formatDistance(t.distance_m, units)}
                    {bearing != null ? (
                      <ThemedText type="subhead" themeColor="textSecondary">
                        {' '}
                        {cardinalFromBearing(bearing)}
                      </ThemedText>
                    ) : null}
                  </ThemedText>
                }
              />
            );
          })
        )}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40 },
  distance: { minWidth: 76, textAlign: 'right' },
});

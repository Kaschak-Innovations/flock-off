import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { ALERT_ICON_MODULES } from '@/alerts/icons';
import { openInMaps } from '@/alerts/notify';
import { ThemedText } from '@/components/themed-text';
import { Button, Chip, Group, Row, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { markAlertsSeen, recentAlerts, unreadAlertCount } from '@/db/db';
import { formatDistance, timeAgo } from '@/geo/geo';
import { useSettings } from '@/store/settings';
import { labelForKind, type AlertRow, type TargetKind } from '@/types';

type Filter = 'all' | 'cameras' | 'traps' | 'limits';

const FILTERS: { id: Filter; label: string; kinds: TargetKind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'cameras', label: 'Cameras', kinds: ['alpr', 'speed_camera', 'camera_report'] },
  { id: 'traps', label: 'Traps', kinds: ['trap'] },
  { id: 'limits', label: 'Limits', kinds: ['limit_drop'] },
];

function dayLabel(ts: number, now: number): string {
  const d = new Date(ts);
  const today = new Date(now);
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  const yesterday = new Date(now - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return 'Earlier';
}

/**
 * Alert history, newest first, with unread dots and kind filters. Opening the screen marks what
 * you see as read; the bell on Status shows the count of alerts you have not looked at.
 */
export default function NotificationsScreen() {
  const [settings] = useSettings();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [unread, setUnread] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [r, u] = await Promise.all([recentAlerts(200), unreadAlertCount()]);
      setRows(r);
      setUnread(u);
      setLoadedAt(Date.now());
    } finally {
      setBusy(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Seen on open: mark the ones on screen as read once they have rendered.
  useEffect(() => {
    if (rows.length === 0) return;
    const unseen = rows.filter((r) => r.seen_at == null).map((r) => r.id);
    if (unseen.length === 0) return;
    const t = setTimeout(() => {
      markAlertsSeen(unseen).then(() => setUnread(0)).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [rows]);

  const units = settings?.units ?? 'imperial';
  const active = FILTERS.find((f) => f.id === filter)!;
  const visible = active.kinds ? rows.filter((r) => active.kinds!.includes(r.kind)) : rows;

  const groups: { label: string; items: AlertRow[] }[] = [];
  for (const r of visible) {
    const label = dayLabel(r.fired_at, loadedAt);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(r);
    else groups.push({ label, items: [r] });
  }

  return (
    <Screen
      back="Status"
      tabBar={false}
      header={{
        title: 'Notifications',
        icon: 'bell',
        color: '#FFB300',
        status: unread > 0 ? `${unread} new` : 'All caught up',
        detail: rows.length > 0 ? `${rows.length} in history` : undefined,
      }}
      refreshing={busy}
      onRefresh={load}>
      <View style={styles.chips}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} on={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
        {unread > 0 ? (
          <View style={{ marginLeft: 'auto' }}>
            <Button title="Mark all read" variant="secondary" compact haptic="none" icon="doneAll" onPress={() => markAlertsSeen().then(load)} />
          </View>
        ) : null}
      </View>

      {groups.length === 0 ? (
        <Group>
          <Row label="Nothing here yet" hint="Every warning the app sends is kept here with its distance and time." last />
        </Group>
      ) : (
        groups.map((g) => (
          <Group key={g.label} label={g.label}>
            {g.items.map((a, i) => (
              <Row
                key={a.id}
                label={labelForKind(a.kind)}
                bold={a.seen_at == null}
                hint={`${formatDistance(a.distance_m, units)} away · ${timeAgo(a.fired_at, loadedAt)}`}
                left={
                  <View style={styles.lead}>
                    <View style={[styles.dot, a.seen_at == null ? styles.dotOn : styles.dotOff]} accessibilityLabel={a.seen_at == null ? 'Unread' : undefined} />
                    <Image source={ALERT_ICON_MODULES[a.kind]} style={styles.icon} resizeMode="contain" accessibilityIgnoresInvertColors />
                  </View>
                }
                onPress={() => openInMaps(a.lat, a.lon, labelForKind(a.kind))}
                accessibilityLabel={`${labelForKind(a.kind)}, ${formatDistance(a.distance_m, units)} away, ${timeAgo(a.fired_at, loadedAt)}. Opens in maps.`}
                icon="open"
                last={i === g.items.length - 1}
              />
            ))}
          </Group>
        ))
      )}

      <ThemedText type="footnote" themeColor="textSecondary">
        Tap an alert to open the spot in your maps app. History is kept on this phone only, 500 alerts at most.
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  lead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: '#FFB300' },
  dotOff: { backgroundColor: 'transparent' },
  icon: { width: 44, height: 44 },
});

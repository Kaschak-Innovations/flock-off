import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, EmptyState, Group, Notice, Row, Screen, TextField, type Tone } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { downloadPack, fetchPackIndex, installedPacks, PACK_STALE_MS, removePack, type InstalledPack, type PackIndex } from '@/data/packs';
import { timeAgo } from '@/geo/geo';
import { usePro } from '@/pro/pro';

const PRO_COLOR = '#FFB300';

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Trip packs (Pro): download whole states ahead of a road trip. */
export default function PacksScreen() {
  const pro = usePro();
  const [index, setIndex] = useState<PackIndex | null>(null);
  const [installed, setInstalled] = useState<Record<string, InstalledPack>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [loading, setLoading] = useState(true);
  // Reference time for "update available", taken when the list loads (render must stay pure).
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idx = await fetchPackIndex();
      setIndex(idx);
      setInstalled(await installedPacks(idx.states.map((s) => s.code)));
      setLoadedAt(idx.updated);
      setMessage(null);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial load; setState happens after the await inside load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const states = useMemo(() => {
    const all = index?.states ?? [];
    const q = filter.trim().toLowerCase();
    const list = q ? all.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q) : all;
    // Downloaded states first, then alphabetical.
    return [...list].sort((a, b) => Number(!!installed[b.code]) - Number(!!installed[a.code]) || a.name.localeCompare(b.name));
  }, [index, filter, installed]);

  const get = async (code: string, name: string) => {
    if (!pro) {
      router.push('/pro');
      return;
    }
    setBusy(code);
    setMessage(null);
    try {
      const got = await downloadPack(code);
      setInstalled({ ...installed, [code]: got });
      setMessage({ text: `${name}: ${got.count.toLocaleString()} cameras ready offline.`, tone: 'success' });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (code: string, name: string) => {
    setBusy(code);
    await removePack(code);
    const next = { ...installed };
    delete next[code];
    setInstalled(next);
    setBusy(null);
    setMessage({ text: `${name} removed. Cameras near you come back with the next local download.`, tone: 'info' });
  };

  const count = Object.keys(installed).length;

  return (
    <Screen
      back="Settings"
      tabBar={false}
      refreshing={loading && !!index}
      onRefresh={load}
      header={{
        title: 'Trip packs',
        icon: 'download',
        color: PRO_COLOR,
        status: count ? `${count} state${count === 1 ? '' : 's'} offline` : 'Whole states, offline',
        detail: index ? `Built ${timeAgo(index.updated)}` : undefined,
      }}>
      {!pro && pro !== null ? (
        <Notice tone="info">Trip packs are part of Pro. You can browse the list; downloading needs Pro.</Notice>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <ThemedText type="subhead" themeColor="textSecondary">
        Every mapped plate reader and speed camera in a state, saved on this phone, so alerts keep working where there is no signal.
        Live speed traps and speed-limit drops still need a connection.
      </ThemedText>

      {index ? (
        <>
          <Group>
            <TextField label="Find a state" value={filter} placeholder="New Hampshire" onCommit={setFilter} />
          </Group>
          <Group>
            {states.map((s, i) => {
              const have = installed[s.code];
              // Stale = the server has a build much newer than this copy.
              const stale = have && loadedAt - have.at > PACK_STALE_MS;
              return (
                <Row
                  key={s.code}
                  label={s.name}
                  bold={!!have}
                  hint={
                    have
                      ? `${have.count.toLocaleString()} cameras · downloaded ${timeAgo(have.at)}${stale ? ' · update available' : ''}`
                      : `${s.count.toLocaleString()} cameras · ${size(s.bytes)}`
                  }
                  last={i === states.length - 1}
                  right={
                    <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                      {have ? (
                        <>
                          {stale ? <Button compact title="Update" onPress={() => get(s.code, s.name)} busy={busy === s.code} /> : null}
                          <Button compact title="Remove" variant="outline" onPress={() => remove(s.code, s.name)} busy={busy === s.code && !stale} />
                        </>
                      ) : (
                        <Button compact title="Get" variant="secondary" icon="download" onPress={() => get(s.code, s.name)} busy={busy === s.code} />
                      )}
                    </View>
                  }
                />
              );
            })}
          </Group>
        </>
      ) : loading ? null : (
        <EmptyState title="No packs to show" body="The pack list could not be loaded." action={<Button title="Try again" onPress={load} />} />
      )}
    </Screen>
  );
}

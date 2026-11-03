import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Group, Icon, Notice, Row, Screen, ToggleRow, type IconName, type Tone } from '@/components/ui';
import { liveCountdownSupported } from '@/alerts/live';
import { Spacing } from '@/constants/theme';
import { buyPro, PRO_FALLBACK_PRICE, proPrice, restorePro, setDevUnlock, usePro } from '@/pro/pro';

const PRO_COLOR = '#FFB300';

const FEATURES: { icon: IconName; title: string; body: string; android?: boolean }[] = [
  { icon: 'speaker', title: 'Spoken alerts', body: '"Flock camera ahead, 1,000 feet, on Route 4." Read out through the car speakers, so your eyes stay on the road.' },
  { icon: 'car', title: 'Automatic drive mode', body: 'Starts on its own when you start driving and stops after you park. No more forgetting to switch it on.' },
  { icon: 'timer', title: 'Live countdown', body: 'A quiet notification that counts down to the next camera while you drive.', android: true },
  { icon: 'download', title: 'Trip packs', body: 'Download whole states before a road trip. Alerts keep working with no signal.' },
  { icon: 'tune', title: 'Alert tuning', body: 'Warning distance and sound for each kind of alert, quiet hours, and silence near home.' },
];

/** The Pro page: what it adds, the one-time purchase, and restore. */
export default function ProScreen() {
  const pro = usePro();
  const [price, setPrice] = useState(PRO_FALLBACK_PRICE);
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: Tone } | null>(null);

  useEffect(() => {
    let alive = true;
    proPrice().then((p) => alive && setPrice(p));
    return () => {
      alive = false;
    };
  }, []);

  const buy = async () => {
    setBusy('buy');
    setMessage(null);
    const r = await buyPro();
    setBusy(null);
    if (r.ok) setMessage({ text: 'Pro is unlocked. Thank you for supporting Flock Off.', tone: 'success' });
    else if (r.message) setMessage({ text: r.message, tone: 'error' });
  };

  const restore = async () => {
    setBusy('restore');
    setMessage(null);
    const owned = await restorePro();
    setBusy(null);
    setMessage(owned ? { text: 'Pro restored.', tone: 'success' } : { text: 'No Pro purchase found for this store account.', tone: 'info' });
  };

  return (
    <Screen
      back="Settings"
      tabBar={false}
      header={{ title: 'Flock Off Pro', icon: 'star', color: PRO_COLOR, status: pro ? 'Unlocked' : `${price}, once`, detail: pro ? 'Thank you' : 'No subscription' }}>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <Group>
        {FEATURES.filter((f) => !f.android || liveCountdownSupported).map((f, i, all) => (
          <Row
            key={f.title}
            label={f.title}
            hint={f.body}
            last={i === all.length - 1}
            left={
              <View style={{ width: 28, alignItems: 'center' }}>
                <Icon name={f.icon} size={22} color={PRO_COLOR} />
              </View>
            }
          />
        ))}
      </Group>

      {pro ? (
        <Notice tone="success">Pro is active on this device. Turn the features on in Settings.</Notice>
      ) : (
        <View style={{ gap: Spacing.sm }}>
          <Button title={`Unlock Pro · ${price}`} icon="star" onPress={buy} busy={busy === 'buy'} haptic="medium" />
          <Button title="Restore purchase" variant="secondary" onPress={restore} busy={busy === 'restore'} />
        </View>
      )}

      <ThemedText type="footnote" themeColor="textSecondary">
        One payment, yours to keep, including features added to Pro later. Every alert, every camera type and reporting stay free for everyone.
      </ThemedText>

      {__DEV__ ? (
        <Group label="Development build">
          <ToggleRow label="Unlock for testing" hint="Only in development builds. Store builds ignore it." value={!!pro} onValueChange={(v) => setDevUnlock(v)} last />
        </Group>
      ) : null}
    </Screen>
  );
}

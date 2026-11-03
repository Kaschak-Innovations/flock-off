import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Backdrop } from '@/components/backdrop';
import { Glass } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { Button, Icon, IconKey, Notice, type IconName, type Tone } from '@/components/ui';
import { PRIVACY_URL } from '@/config';
import { Radius, Spacing, TabColors } from '@/constants/theme';
import { enableDriveMode, enableMonitoring, type SwitchResult } from '@/engine/monitoring';
import { saveSettings } from '@/store/settings';

/**
 * Prominent disclosure for background location, shown before the system permission prompt.
 * Google Play's policy asks for exactly this: in-app, before the prompt, naming the data, the
 * feature it powers, and that it happens while the app is closed, with an explicit Continue.
 * It is also just good manners: the next two system prompts make much more sense after it.
 */
export default function DisclosureScreen() {
  const { intent } = useLocalSearchParams<{ intent?: 'monitor' | 'drive' }>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SwitchResult | null>(null);

  const proceed = async () => {
    setBusy(true);
    try {
      await saveSettings({ disclosureAccepted: true });
      const r = intent === 'drive' ? await enableDriveMode() : await enableMonitoring();
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const tone: Tone = result ? (result.ok ? 'success' : 'error') : 'info';

  return (
    <Backdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.wrap}>
          <View style={styles.hero}>
            <IconKey name="shield" color={TabColors.status} size={72} iconSize={36} />
            <ThemedText type="largeTitle" accessibilityRole="header" style={styles.center}>
              Location, even when closed
            </ThemedText>
            <ThemedText type="subhead" themeColor="textSecondary" style={styles.center}>
              Before your phone asks, here is what Flock Off does with your location and why.
            </ThemedText>
          </View>

          <Glass variant="panel" radius={Radius.lg} style={styles.panel}>
            <Point icon="radar" color={TabColors.status} title="Collects your location in the background" body="Flock Off collects location data to warn you about license plate readers, speed cameras and reported speed traps near you, even when the app is closed or not in use." />
            <Point icon="car" color={TabColors.nearby} title="Uses it only for warnings" body="Your position is compared with camera locations stored on this phone. It is never uploaded, logged or shared, and there is no account." />
            <Point icon="pin" color={TabColors.report} title="You choose what leaves the phone" body="Only the reports you tap to send (a camera or speed trap at a spot) go to the report server, with no identity attached." last />
          </Glass>

          <ThemedText type="footnote" themeColor="textSecondary" style={styles.center}>
            Next, your phone will ask for location access. Choose <ThemedText type="footnote" style={{ fontWeight: '700' }}>Allow all the time</ThemedText> on Android or <ThemedText type="footnote" style={{ fontWeight: '700' }}>Always</ThemedText> on iPhone so alerts work with the app closed.{' '}
            <ThemedText type="footnote" style={{ color: '#FFB300' }} onPress={() => Linking.openURL(PRIVACY_URL)}>
              Privacy policy
            </ThemedText>
          </ThemedText>

          {result ? <Notice tone={tone}>{result.message}</Notice> : null}

          <View style={styles.actions}>
            {result ? (
              <Button title="Done" onPress={() => router.back()} />
            ) : (
              <>
                <Button title="Continue" icon="check" onPress={proceed} busy={busy} />
                <Button title="Not now" variant="secondary" onPress={() => router.back()} disabled={busy} />
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    </Backdrop>
  );
}

function Point({ icon, color, title, body, last }: { icon: IconName; color: string; title: string; body: string; last?: boolean }) {
  return (
    <View style={[styles.point, !last && styles.pointBorder]}>
      <View style={styles.pointIcon}>
        <Icon name={icon} size={22} color={color} />
      </View>
      <View style={styles.pointText}>
        <ThemedText type="headline">{title}</ThemedText>
        <ThemedText type="subhead" themeColor="textSecondary">
          {body}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  wrap: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl, paddingBottom: Spacing.lg, gap: Spacing.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  center: { textAlign: 'center' },
  panel: { paddingHorizontal: Spacing.lg },
  point: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.md },
  pointBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255, 255, 255, 0.10)' },
  pointIcon: { width: 28, alignItems: 'center', paddingTop: 2 },
  pointText: { flex: 1, gap: 2 },
  actions: { marginTop: 'auto', gap: Spacing.sm },
});

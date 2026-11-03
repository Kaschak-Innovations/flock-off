import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Glass } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui';
import { Radius, Spacing, TabBarHeight, TabColors } from '@/constants/theme';

/** Tab identity: label, platform icon, and the color the icon always wears, selected or not. */
const TABS: Record<string, { label: string; icon: IconName; color: string }> = {
  index: { label: 'Status', icon: 'radar', color: TabColors.status },
  nearby: { label: 'Nearby', icon: 'list', color: TabColors.nearby },
  report: { label: 'Report', icon: 'pin', color: TabColors.report },
  settings: { label: 'Settings', icon: 'gear', color: TabColors.settings },
};

/**
 * Four glass keys on a frosted strip. The selected key is a brighter pane with a white label;
 * the others are dim keys with gray labels. Icons keep their own color in both states.
 */
export function TabBar({ state, descriptors, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const bottom = Math.max(insets.bottom, Platform.OS === 'ios' ? 0 : Spacing.sm);
  return (
    <Glass variant="bar" radius={0} style={[styles.bar, { paddingBottom: bottom + Spacing.sm }]}>
      <View role="tablist" style={styles.row}>
        {state.routes.map((route, index) => {
          const focused = index === state.index;
          const tab = TABS[route.name] ?? { label: descriptors[route.key]?.options.title ?? route.name, icon: 'radar' as IconName, color: '#FFFFFF' };
          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) {
              Haptics.selectionAsync().catch(() => {});
              navigateToTab(route.key);
            }
          };
          return (
            <Pressable
              key={route.key}
              role="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              onPress={onPress}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
              <Glass variant={focused ? 'keySelected' : 'key'} radius={Radius.md} style={styles.keyInner}>
                <Icon name={tab.icon} size={24} color={tab.color} />
                <ThemedText type="caption" style={[styles.label, focused ? styles.labelOn : styles.labelOff]}>
                  {tab.label}
                </ThemedText>
              </Glass>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  row: { flexDirection: 'row', gap: Spacing.sm, height: TabBarHeight - Spacing.sm },
  key: { flex: 1 },
  pressed: { opacity: 0.8 },
  keyInner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, lineHeight: 14 },
  labelOn: { color: '#FFFFFF', fontWeight: '600' },
  labelOff: { color: '#B9BDC5', fontWeight: '500' },
});

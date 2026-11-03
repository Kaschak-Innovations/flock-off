import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Backdrop } from '@/components/backdrop';
import { Glass } from '@/components/glass';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing, TabBarHeight, TouchTarget, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/* ------------------------------------------------------------------ icons */

export type IconName =
  | 'radar' | 'list' | 'pin' | 'gear' | 'bell' | 'back' | 'open' | 'chevron' | 'camera' | 'speed'
  | 'warning' | 'locate' | 'check' | 'error' | 'shield' | 'doc' | 'car' | 'doneAll';

const ICONS: Record<IconName, SymbolViewProps['name']> = {
  radar: { ios: 'dot.radiowaves.left.and.right', android: 'sensors' },
  list: { ios: 'list.bullet', android: 'list' },
  pin: { ios: 'mappin.and.ellipse', android: 'add_location' },
  gear: { ios: 'gearshape.fill', android: 'settings' },
  bell: { ios: 'bell.fill', android: 'notifications' },
  back: { ios: 'chevron.left', android: 'arrow_back_ios_new' },
  open: { ios: 'arrow.up.right', android: 'open_in_new' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  camera: { ios: 'video.fill', android: 'videocam' },
  speed: { ios: 'gauge.with.needle', android: 'speed' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  locate: { ios: 'location.fill', android: 'my_location' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  error: { ios: 'xmark.octagon.fill', android: 'error' },
  shield: { ios: 'lock.shield.fill', android: 'shield' },
  doc: { ios: 'doc.text', android: 'description' },
  car: { ios: 'car.fill', android: 'directions_car' },
  doneAll: { ios: 'checkmark.circle', android: 'done_all' },
};

/** Platform icon: SF Symbol on iOS, Material Symbol on Android, one name on both sides of the app. */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return <SymbolView name={ICONS[name]} size={size} tintColor={color ?? theme.textSecondary} style={{ width: size, height: size }} />;
}

/** A raised glass key holding an icon: the header badge, the bell, the report buttons' leading mark. */
export function IconKey({ name, color, size = 56, iconSize = 28, selected }: { name: IconName; color: string; size?: number; iconSize?: number; selected?: boolean }) {
  return (
    <Glass variant={selected ? 'keySelected' : 'key'} radius={size >= 56 ? Radius.lg : Radius.md} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={iconSize} color={color} />
    </Glass>
  );
}

/* ---------------------------------------------------------------- screen */

export type ScreenHeader = {
  title: string;
  icon: IconName;
  color: string;
  /** Status line: the bold part and the gray detail after the dot. */
  status: string;
  detail?: string;
  /** Unread count for the bell; undefined hides the bell. */
  unread?: number;
};

/**
 * Scrollable screen on the carbon backdrop, with the icon-key header, optional pull-to-refresh,
 * and room at the bottom for the floating tab bar.
 */
export function Screen({
  children,
  header,
  refreshing,
  onRefresh,
  back,
  tabBar = true,
}: PropsWithChildren<{ header: ScreenHeader; refreshing?: boolean; onRefresh?: () => void; back?: string; tabBar?: boolean }>) {
  const theme = useTheme();
  return (
    <Backdrop>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: (tabBar ? TabBarHeight + Spacing.xl : Spacing.xl) + Spacing.xxl }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} colors={[theme.accent]} /> : undefined
          }>
          {back ? (
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={`Back to ${back}`} style={styles.back}>
              <Icon name="back" size={18} color={theme.accent} />
              <ThemedText type="body" style={{ color: theme.accent }}>
                {back}
              </ThemedText>
            </Pressable>
          ) : null}
          <Header {...header} />
          {children}
        </ScrollView>
      </SafeAreaView>
    </Backdrop>
  );
}

function Header({ title, icon, color, status, detail, unread }: ScreenHeader) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <IconKey name={icon} color={color} />
      <View style={styles.headerText}>
        <ThemedText type="largeTitle" accessibilityRole="header" numberOfLines={1}>
          {title}
        </ThemedText>
        <View style={styles.statusLine}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <ThemedText type="subhead" numberOfLines={1} style={{ flexShrink: 1 }}>
            <ThemedText type="subhead" style={{ fontWeight: '600' }}>
              {status}
            </ThemedText>
            {detail ? (
              <ThemedText type="subhead" themeColor="textSecondary">
                {' · '}
                {detail}
              </ThemedText>
            ) : null}
          </ThemedText>
        </View>
      </View>
      {unread !== undefined ? (
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Notifications, ${unread} new` : 'Notifications'}
          style={({ pressed }) => [styles.bell, pressed && { opacity: 0.8 }]}>
          <IconKey name="bell" color="#FFFFFF" size={TouchTarget} iconSize={22} />
          {unread > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.background }]}>
              <ThemedText type="caption" style={styles.badgeText}>
                {unread > 99 ? '99+' : unread}
              </ThemedText>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ list group */

/** Inset grouped list on a glass panel, the platform shape for settings-like content. */
export function Group({ children, style, label }: PropsWithChildren<{ style?: StyleProp<ViewStyle>; label?: string }>) {
  return (
    <View style={styles.groupWrap}>
      {label ? <SectionTitle>{label}</SectionTitle> : null}
      <Glass variant="panel" radius={Radius.lg} style={[styles.group, style]}>
        {children}
      </Glass>
    </View>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  return (
    <ThemedText type="footnote" themeColor="textSecondary" style={[styles.sectionTitle, Platform.OS === 'ios' ? styles.sectionTitleIos : styles.sectionTitleAndroid]}>
      {children}
    </ThemedText>
  );
}

export function Row({
  label,
  hint,
  right,
  left,
  onPress,
  icon,
  last,
  accessibilityLabel,
  bold,
}: {
  label: string;
  hint?: string;
  right?: ReactNode;
  /** Leading element, such as an alert picture. */
  left?: ReactNode;
  onPress?: () => void;
  /** Trailing affordance when the whole row is tappable. */
  icon?: IconName;
  /** Last row in a group: no separator. */
  last?: boolean;
  accessibilityLabel?: string;
  bold?: boolean;
}) {
  const theme = useTheme();
  const body = (
    <View style={[styles.row, !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      {left}
      <View style={styles.rowText}>
        <ThemedText type={bold ? 'headline' : 'body'} numberOfLines={2}>
          {label}
        </ThemedText>
        {hint ? (
          <ThemedText type="subhead" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {right}
      {onPress && icon ? <Icon name={icon} size={18} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.rowPressable, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      {body}
    </Pressable>
  );
}

export function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
  disabled,
  last,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row
      label={label}
      hint={hint}
      last={last}
      right={
        <Switch
          value={value}
          onValueChange={(v) => {
            Haptics.selectionAsync().catch(() => {});
            onValueChange(v);
          }}
          disabled={disabled}
          accessibilityLabel={label}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          ios_backgroundColor={theme.backgroundSelected}
        />
      }
    />
  );
}

/* --------------------------------------------------------------- buttons */

export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  icon,
  haptic = 'light',
  compact,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger';
  busy?: boolean;
  disabled?: boolean;
  icon?: IconName;
  haptic?: 'light' | 'medium' | 'none';
  compact?: boolean;
}) {
  const theme = useTheme();
  const inactive = disabled || busy;
  const press = () => {
    if (haptic !== 'none') {
      Haptics.impactAsync(haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    onPress();
  };
  const fg = variant === 'primary' ? theme.accentText : variant === 'danger' ? theme.dangerText : variant === 'outline' ? theme.accent : theme.text;
  const inner = busy ? (
    <ActivityIndicator color={fg} />
  ) : (
    <View style={styles.buttonInner}>
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <ThemedText type="headline" style={{ color: fg }}>
        {title}
      </ThemedText>
    </View>
  );
  const a11y = { accessibilityRole: 'button' as const, accessibilityState: { disabled: !!inactive, busy: !!busy } };

  if (variant === 'secondary') {
    // Secondary buttons are glass keys, like the tab bar.
    return (
      <Pressable onPress={press} disabled={inactive} {...a11y} style={({ pressed }) => [{ opacity: inactive ? 0.45 : pressed ? 0.75 : 1 }]}>
        <Glass variant="key" radius={compact ? Radius.md : Radius.lg} style={[styles.button, compact && styles.buttonCompact]}>
          {inner}
        </Glass>
      </Pressable>
    );
  }
  const solid = {
    primary: { backgroundColor: theme.accent, borderColor: theme.accent },
    outline: { backgroundColor: 'transparent', borderColor: theme.accent },
    danger: { backgroundColor: theme.danger, borderColor: theme.danger },
  }[variant];
  return (
    <Pressable
      onPress={press}
      disabled={inactive}
      {...a11y}
      style={({ pressed }) => [styles.button, compact && styles.buttonCompact, styles.buttonSolid, solid, { opacity: inactive ? 0.45 : pressed ? 0.75 : 1 }]}>
      {inner}
    </Pressable>
  );
}

/* ---------------------------------------------------------------- inputs */

export function NumberField({
  label,
  hint,
  value,
  onCommit,
  suffix,
  min,
  max,
  last,
}: {
  label: string;
  hint?: string;
  value: number;
  onCommit: (v: number) => void;
  suffix?: string;
  min: number;
  max: number;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row
      label={label}
      hint={hint}
      last={last}
      right={
        <View style={styles.numberWrap}>
          <TextInput
            defaultValue={String(value)}
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel={label}
            selectTextOnFocus
            onEndEditing={(e) => {
              const n = Number(e.nativeEvent.text);
              if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
            }}
            style={[styles.numberInput, Type.body, { color: theme.text, borderColor: theme.border }]}
          />
          {suffix ? (
            <ThemedText type="subhead" themeColor="textSecondary" style={styles.suffix}>
              {suffix}
            </ThemedText>
          ) : null}
        </View>
      }
    />
  );
}

export function TextField({
  label,
  hint,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.textFieldWrap}>
      <ThemedText type="body">{label}</ThemedText>
      {hint ? (
        <ThemedText type="subhead" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      <TextInput
        defaultValue={value}
        placeholder={placeholder}
        placeholderTextColor={theme.textTertiary}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
        onEndEditing={(e) => onCommit(e.nativeEvent.text.trim())}
        style={[styles.textInput, Type.subhead, { color: theme.text, borderColor: theme.border }]}
      />
    </View>
  );
}

/* ---------------------------------------------------------------- status */

export type Tone = 'info' | 'warn' | 'error' | 'success';

/** Inline status line on a glass panel: an icon in the tone color, text in the normal ink. */
export function Notice({ children, tone = 'info' }: PropsWithChildren<{ tone?: Tone }>) {
  const theme = useTheme();
  const color = tone === 'error' ? theme.danger : tone === 'warn' ? theme.warning : tone === 'success' ? theme.success : theme.textSecondary;
  const icon: IconName = tone === 'error' ? 'error' : tone === 'warn' ? 'warning' : tone === 'success' ? 'check' : 'locate';
  return (
    <Glass variant="panel" radius={Radius.md} style={styles.notice}>
      <View style={styles.noticeInner} accessibilityLiveRegion="polite">
        <Icon name={icon} size={18} color={color} />
        <ThemedText type="subhead" style={styles.noticeText}>
          {children}
        </ThemedText>
      </View>
    </Glass>
  );
}

export function Pill({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'on' | 'off' }>) {
  const theme = useTheme();
  const bg = tone === 'on' ? theme.success : theme.backgroundSelected;
  const fg = tone === 'on' ? theme.successText : theme.textSecondary;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <ThemedText type="caption" style={{ color: fg }}>
        {children}
      </ThemedText>
    </View>
  );
}

/** Small glass chip used for filters; `on` is the pressed/selected state. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
      <Glass variant={on ? 'keySelected' : 'key'} radius={Radius.md} style={styles.chip}>
        <ThemedText type="subhead" style={{ color: on ? '#FFFFFF' : '#B9BDC5', fontWeight: on ? '600' : '500' }}>
          {label}
        </ThemedText>
      </Glass>
    </Pressable>
  );
}

/** Empty state that teaches: what this screen shows and the one action that fills it. */
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <ThemedText type="headline" style={styles.emptyTitle}>
        {title}
      </ThemedText>
      <ThemedText type="subhead" themeColor="textSecondary" style={styles.emptyBody}>
        {body}
      </ThemedText>
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.lg,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: TouchTarget, alignSelf: 'flex-start', marginLeft: -Spacing.xs, marginBottom: -Spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md + 2, paddingBottom: Spacing.xs },
  headerText: { flex: 1, minWidth: 0, gap: 3 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bell: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11, lineHeight: 14 },
  groupWrap: { gap: Spacing.sm },
  group: { paddingHorizontal: Spacing.lg },
  sectionTitle: { paddingHorizontal: Spacing.lg },
  sectionTitleIos: { textTransform: 'uppercase', letterSpacing: 0.3 },
  sectionTitleAndroid: { fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    minHeight: TouchTarget + Spacing.xs,
    paddingVertical: Spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  rowPressable: { marginHorizontal: -Spacing.lg, paddingHorizontal: Spacing.lg },
  button: { minHeight: 52, paddingVertical: Spacing.md, paddingHorizontal: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  buttonSolid: { borderRadius: Radius.lg, borderWidth: 1.5 },
  buttonCompact: { minHeight: TouchTarget, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.lg, borderRadius: Radius.md },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  numberWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  numberInput: {
    minWidth: 76,
    minHeight: TouchTarget,
    textAlign: 'right',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.30)',
  },
  suffix: { minWidth: 28 },
  textFieldWrap: { gap: Spacing.xs, paddingVertical: Spacing.md },
  textInput: { minHeight: TouchTarget, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderWidth: 1, borderRadius: Radius.md, backgroundColor: 'rgba(0, 0, 0, 0.30)' },
  notice: {},
  noticeInner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  noticeText: { flex: 1 },
  pill: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.pill },
  chip: { minHeight: 36, paddingHorizontal: Spacing.lg - 2, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: Spacing.xl, alignItems: 'center', gap: Spacing.sm },
  emptyTitle: { textAlign: 'center' },
  emptyBody: { textAlign: 'center', maxWidth: 320 },
  emptyAction: { marginTop: Spacing.sm, alignSelf: 'stretch' },
});

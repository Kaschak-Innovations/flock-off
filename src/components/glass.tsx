import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Glass as GlassTokens, Radius } from '@/constants/theme';

type Variant = keyof typeof GlassTokens;

const liquid = Platform.OS === 'ios' && isLiquidGlassAvailable();

/**
 * One frosted surface for panels, keys and the tab bar.
 * iOS 26+: Liquid Glass. Older iOS: a system blur. Android: translucent solid (no live blur).
 * The thin border and top highlight are what sell the material; the blur only helps.
 */
export function Glass({
  variant = 'panel',
  radius = Radius.lg,
  style,
  children,
}: PropsWithChildren<{ variant?: Variant; radius?: number; style?: StyleProp<ViewStyle> }>) {
  const t = GlassTokens[variant];
  const shape: ViewStyle = { borderRadius: radius, overflow: 'hidden' };
  const frame: ViewStyle = { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.border };

  if (Platform.OS !== 'ios') {
    return (
      <View style={[shape, frame, { backgroundColor: t.fillAndroid }, style]}>
        <View style={[styles.highlight, { backgroundColor: t.highlight }]} pointerEvents="none" />
        {children}
      </View>
    );
  }

  if (liquid && variant !== 'bar') {
    return (
      <GlassView glassEffectStyle="regular" colorScheme="dark" style={[shape, frame, style]}>
        <View style={[StyleSheet.absoluteFill, { backgroundColor: t.fill }]} pointerEvents="none" />
        <View style={[styles.highlight, { backgroundColor: t.highlight }]} pointerEvents="none" />
        {children}
      </GlassView>
    );
  }

  return (
    <View style={[shape, frame, style]}>
      <BlurView intensity={variant === 'bar' ? 40 : 28} tint="systemUltraThinMaterialDark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.fill }]} pointerEvents="none" />
      <View style={[styles.highlight, { backgroundColor: t.highlight }]} pointerEvents="none" />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  highlight: { position: 'absolute', left: 0, right: 0, top: 0, height: StyleSheet.hairlineWidth * 2 },
});

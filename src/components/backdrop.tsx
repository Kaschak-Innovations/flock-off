import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import { ImageBackground, StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

/**
 * The carbon-weave wallpaper every screen sits on: a tiny repeating tile (drawn at 1x/2x/3x so it
 * stays crisp) plus a soft white light from the top. Costs one tiled image, no shaders.
 */
export function Backdrop({ children }: PropsWithChildren) {
  return (
    <View style={styles.root}>
      <ImageBackground source={require('@/assets/images/carbon.png')} resizeMode="repeat" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={['rgba(255, 255, 255, 0.10)', 'rgba(255, 255, 255, 0.0)']}
        locations={[0, 1]}
        style={styles.glow}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark.background },
  glow: { position: 'absolute', left: 0, right: 0, top: 0, height: '45%' },
});

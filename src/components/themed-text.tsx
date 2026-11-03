import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: keyof typeof Type | 'mono';
  themeColor?: ThemeColor;
};

/** Text that follows the theme and the platform type scale. Font scaling stays on for Dynamic Type. */
export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={1.6}
      style={[{ color: theme[themeColor ?? 'text'] }, type === 'mono' ? styles.mono : Type[type], style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  mono: {
    fontFamily: Fonts?.mono,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});

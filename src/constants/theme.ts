import { Platform } from 'react-native';

/**
 * Design tokens for the glass-and-carbon look. The app is dark-only (app.json sets
 * userInterfaceStyle to "dark"): frosted glass needs a dark, textured backdrop to read.
 * Every text/surface pair below clears WCAG AA (4.5:1) over the carbon backdrop.
 */
export const Colors = {
  light: {
    text: '#FFFFFF',
    textSecondary: '#B9BDC5',
    textTertiary: '#8A8D94',
    background: '#0A0B0E',
    backgroundElement: 'rgba(255, 255, 255, 0.07)',
    backgroundSelected: 'rgba(255, 255, 255, 0.16)',
    border: 'rgba(255, 255, 255, 0.10)',
    accent: '#FFB300',
    accentText: '#0B0B0D',
    danger: '#FF5252',
    dangerText: '#0B0B0D',
    success: '#4CD964',
    successText: '#0B0B0D',
    warning: '#FFB300',
  },
  dark: {
    text: '#FFFFFF',
    textSecondary: '#B9BDC5',
    textTertiary: '#8A8D94',
    background: '#0A0B0E',
    backgroundElement: 'rgba(255, 255, 255, 0.07)',
    backgroundSelected: 'rgba(255, 255, 255, 0.16)',
    border: 'rgba(255, 255, 255, 0.10)',
    accent: '#FFB300',
    accentText: '#0B0B0D',
    danger: '#FF5252',
    dangerText: '#0B0B0D',
    success: '#4CD964',
    successText: '#0B0B0D',
    warning: '#FFB300',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Theme = (typeof Colors)['light'] | (typeof Colors)['dark'];

/** Per-tab identity colors (the "Rich" set). Used for tab icons, header keys and status dots. */
export const TabColors = {
  status: '#22C55E',
  nearby: '#0EA5E9',
  report: '#EF4444',
  settings: '#EAB308',
} as const;

/** Colors behind each alert kind on Android, where a notification can't carry its own picture. */
export const AlertColors = {
  alpr: '#22C55E',
  camera_report: '#0EA5E9',
  trap: '#EF4444',
  speed_camera: '#EAB308',
  limit_drop: '#FFFFFF',
} as const;

/**
 * Glass surfaces. iOS gets a real blur (or Liquid Glass on iOS 26); Android gets a translucent
 * solid so low-end phones don't pay for a live blur. The numbers mirror the design mockups.
 */
export const Glass = {
  panel: { fill: 'rgba(255, 255, 255, 0.07)', fillAndroid: 'rgba(26, 27, 31, 0.92)', border: 'rgba(255, 255, 255, 0.13)', highlight: 'rgba(255, 255, 255, 0.12)' },
  key: { fill: 'rgba(255, 255, 255, 0.10)', fillAndroid: 'rgba(37, 39, 45, 0.95)', border: 'rgba(255, 255, 255, 0.16)', highlight: 'rgba(255, 255, 255, 0.18)' },
  keySelected: { fill: 'rgba(255, 255, 255, 0.24)', fillAndroid: 'rgba(70, 72, 80, 0.98)', border: 'rgba(255, 255, 255, 0.38)', highlight: 'rgba(255, 255, 255, 0.30)' },
  bar: { fill: 'rgba(8, 9, 12, 0.45)', fillAndroid: 'rgba(8, 9, 12, 0.94)', border: 'rgba(255, 255, 255, 0.10)', highlight: 'rgba(255, 255, 255, 0.06)' },
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  default: { sans: 'normal', mono: 'monospace' },
});

/** Type scale mirroring the platform text styles; steps ~1.15 apart. */
export const Type = {
  largeTitle: { fontSize: 30, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
} as const;

/** 4-pt spacing scale. */
export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const Radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

/** Minimum tappable size on both platforms. */
export const TouchTarget = 44;

/** Height of the custom tab bar above the home indicator. */
export const TabBarHeight = 62;
export const MaxContentWidth = 800;

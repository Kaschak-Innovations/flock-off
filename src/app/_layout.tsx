// Background tasks must be defined at module scope before anything else renders.
import '@/tasks';

import * as Notifications from 'expo-notifications';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { prepareAlertIcons } from '@/alerts/icons';
import { handleNotificationResponse } from '@/alerts/notify';
import { Colors } from '@/constants/theme';
import { refreshEntitlement, startPurchaseListener } from '@/pro/pro';

SplashScreen.preventAutoHideAsync();

// Show alerts even while the app is in the foreground (you may be on the Nearby tab while driving).
// The live countdown updates every few seconds, so it never pops up a banner.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const live = (n.request.content.data as { live?: boolean } | undefined)?.live === true;
    return { shouldShowBanner: !live, shouldShowList: true, shouldPlaySound: !live, shouldSetBadge: false };
  },
});

/** Tapping an alert opens the camera in the phone's default map app with a labeled pin. */
function useNotificationTapObserver() {
  useEffect(() => {
    let active = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (active && response) {
          handleNotificationResponse(response);
        }
      })
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
}

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: Colors.dark.background, card: Colors.dark.background, primary: Colors.dark.accent, text: Colors.dark.text },
};

export default function RootLayout() {
  useNotificationTapObserver();

  useEffect(() => {
    prepareAlertIcons().finally(() => SplashScreen.hideAsync());
  }, []);

  // Pro: re-check what the store says on every launch (refunds, purchases on another device) and
  // settle purchases that complete while the app is open.
  useEffect(() => {
    let stop: (() => void) | null = null;
    refreshEntitlement().catch(() => {});
    startPurchaseListener().then((s) => (stop = s));
    return () => stop?.();
  }, []);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.dark.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="disclosure" options={{ presentation: 'modal', gestureEnabled: false }} />
        <Stack.Screen name="pro" />
        <Stack.Screen name="packs" />
        <Stack.Screen name="tuning" />
      </Stack>
    </ThemeProvider>
  );
}

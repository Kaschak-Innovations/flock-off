import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { TargetKind } from '@/types';

/**
 * The five alert pictures. On iOS each alert carries one as a notification attachment, which
 * shows as the large thumbnail on the right of the banner. The app icon stays on the left; that
 * part of a notification isn't ours to change.
 *
 * iOS *moves* an attachment file into the notification store, so we never hand it the bundled
 * asset. On first launch the assets are copied into the documents folder; each alert then gets its
 * own temporary copy in the cache folder.
 */
export const ALERT_ICON_MODULES: Record<TargetKind, number> = {
  alpr: require('@/assets/icons/flock.png'),
  camera_report: require('@/assets/icons/possible.png'),
  trap: require('@/assets/icons/trap.png'),
  speed_camera: require('@/assets/icons/speedcam.png'),
  limit_drop: require('@/assets/icons/limit.png'),
};

const DIR_NAME = 'alert-icons';

function iconsDir(): Directory {
  return new Directory(Paths.document, DIR_NAME);
}

function storedFile(kind: TargetKind): File {
  return new File(iconsDir(), `${kind}.png`);
}

/** Call once from the foreground (app start). Idempotent and cheap after the first run. */
export async function prepareAlertIcons(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const dir = iconsDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    for (const kind of Object.keys(ALERT_ICON_MODULES) as TargetKind[]) {
      const dest = storedFile(kind);
      if (dest.exists) continue;
      const asset = Asset.fromModule(ALERT_ICON_MODULES[kind]);
      await asset.downloadAsync();
      if (!asset.localUri) continue;
      await new File(asset.localUri).copy(dest);
    }
  } catch (e) {
    console.warn('[flockoff] alert icon prep failed', e);
  }
}

/**
 * A fresh copy of the icon for one notification, or null when icons aren't ready yet
 * (first alert before the app has ever been opened, or a cleared documents folder).
 */
export async function attachmentFor(kind: TargetKind): Promise<{ identifier: string; url: string; type: string } | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const src = storedFile(kind);
    if (!src.exists) return null;
    const dest = new File(Paths.cache, `alert-${kind}-${Date.now()}.png`);
    await src.copy(dest);
    return { identifier: `icon-${kind}`, url: dest.uri, type: 'public.png' };
  } catch (e) {
    console.warn('[flockoff] alert icon copy failed', e);
    return null;
  }
}

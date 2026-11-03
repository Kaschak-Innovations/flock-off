import * as Speech from 'expo-speech';

import { FT_PER_M, M_PER_MI } from '@/geo/geo';
import { displayName, type Target } from '@/types';

/**
 * Spoken alerts (Pro). Phrased the way a navigation app talks: the thing, then how far, then
 * where. Numbers are written out the way text-to-speech reads them best.
 */


export function spokenDistance(meters: number, units: 'imperial' | 'metric'): string {
  if (units === 'metric') {
    if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} meters`;
    const km = meters / 1000;
    return km < 10 ? `${km.toFixed(1)} kilometers` : `${Math.round(km)} kilometers`;
  }
  const feet = meters * FT_PER_M;
  if (feet < 1000) return `${Math.max(100, Math.round(feet / 100) * 100)} feet`;
  const miles = meters / M_PER_MI;
  if (miles < 0.35) return 'a quarter mile';
  if (miles < 0.65) return 'half a mile';
  if (miles < 0.85) return 'three quarters of a mile';
  if (miles < 1.15) return 'one mile';
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} miles`;
}

export function spokenCopy(target: Target, distanceM: number, ahead: boolean, units: 'imperial' | 'metric', road: string | null): string {
  const where = road ? `, on ${road}` : '';
  const dist = spokenDistance(distanceM, units);
  const lead = ahead ? 'ahead' : 'nearby';
  switch (target.kind) {
    case 'limit_drop':
      return `Speed limit drops to ${target.toMph} in ${dist}${where}.`;
    case 'trap':
      return `Speed trap reported ${lead}, ${dist}${where}.`;
    case 'camera_report':
      return `Possible camera ${lead}, ${dist}${where}.`;
    default:
      return `${displayName(target)} ${lead}, ${dist}${where}.`;
  }
}

export function speak(text: string): void {
  try {
    Speech.speak(text, {
      language: 'en-US',
      rate: 1.0,
      // iOS: let the synthesizer manage its own audio session so it ducks music and keeps
      // speaking with the screen off; the app's own session would be silenced by the ring switch.
      useApplicationAudioSession: false,
    });
  } catch (e) {
    console.warn('[flockoff] speech failed', e);
  }
}

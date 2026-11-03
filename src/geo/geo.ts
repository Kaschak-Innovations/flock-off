/**
 * Small geodesy helpers. Everything is in meters and degrees unless stated otherwise.
 */

export type LatLon = { lat: number; lon: number };

export type BBox = { south: number; west: number; north: number; east: number };

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in meters. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, 0..360 (0 = north, 90 = east). */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Bounding box that contains a circle of the given radius around a point. */
export function bboxAround(lat: number, lon: number, radiusKm: number): BBox {
  const dLat = (radiusKm * 1000) / EARTH_RADIUS_M;
  const dLon = dLat / Math.max(Math.cos(toRad(lat)), 0.01);
  return {
    south: Math.max(-90, lat - toDeg(dLat)),
    north: Math.min(90, lat + toDeg(dLat)),
    west: Math.max(-180, lon - toDeg(dLon)),
    east: Math.min(180, lon + toDeg(dLon)),
  };
}

/** Smallest absolute difference between two headings, 0..180. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const CARDINALS: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/**
 * Parse an OSM `direction` / `camera:direction` value into degrees.
 * Accepts numbers ("135"), ranges ("90-120" → midpoint), and cardinals ("NE").
 * Returns null when the tag is missing or unparseable.
 */
export function parseDirection(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (value in CARDINALS) return CARDINALS[value];
  const range = value.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  if (range) {
    const a = parseFloat(range[1]);
    const b = parseFloat(range[2]);
    const span = ((b - a) % 360 + 360) % 360;
    return (a + span / 2 + 360) % 360;
  }
  const num = parseFloat(value);
  if (Number.isFinite(num)) return ((num % 360) + 360) % 360;
  return null;
}

/**
 * Direction-aware relevance: a camera whose facing direction is roughly parallel to your
 * heading (either way) is watching your road; one that is perpendicular is watching a cross street.
 * Unknown headings or directions always count as relevant: a missed alert costs more than a spare one.
 */
export function isDirectionRelevant(
  heading: number | null | undefined,
  cameraDirection: number | null | undefined,
  toleranceDeg: number,
): boolean {
  if (heading == null || cameraDirection == null) return true;
  const d = angleDiff(heading, cameraDirection);
  return d <= toleranceDeg || d >= 180 - toleranceDeg;
}

export function cardinalFromBearing(bearing: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(bearing / 45) % 8];
}

export type Units = 'imperial' | 'metric';

export const FT_PER_M = 3.28084;
export const M_PER_MI = 1609.344;

/**
 * Glanceable distances. Imperial (US default): feet under about a quarter mile, rounded to 50,
 * then miles with one decimal. Metric: meters rounded to 10, then kilometers with one decimal.
 */
export function formatDistance(meters: number, units: Units = 'imperial'): string {
  if (units === 'metric') {
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    const km = meters / 1000;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  const feet = meters * FT_PER_M;
  if (feet < 1584) {
    const rounded = Math.max(50, Math.round(feet / 50) * 50);
    return `${rounded.toLocaleString('en-US')} ft`;
  }
  const miles = meters / M_PER_MI;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/** "just now", "4 min ago", "2 h ago", "3 d ago". */
export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const mins = Math.round((now - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

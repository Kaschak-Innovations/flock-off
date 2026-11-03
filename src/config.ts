import { Platform } from 'react-native';

/**
 * Names of the background tasks registered with expo-task-manager.
 * These must be stable across app updates: the OS remembers them.
 */
export const TASKS = {
  GEOFENCE: 'flockoff-geofence',
  DRIVE: 'flockoff-drive',
} as const;

/** Identifier of the single large "bubble" region whose exit triggers a geofence refresh. */
export const BUBBLE_ID = 'bubble';

/** iOS caps monitored regions at 20, Android at 100. One slot is reserved for the bubble. */
export const MAX_REGIONS = Platform.OS === 'ios' ? 20 : 100;
export const MAX_TARGET_REGIONS = MAX_REGIONS - 1;

/** Overpass mirrors, tried in order. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Where the project lives. Used as the contact in the OSM User-Agent and as the privacy-policy fallback. */
export const PROJECT_URL = 'https://github.com/Kaschak-Innovations/flock-off';

/** OSM asks API clients to identify themselves with a project URL or contact. */
export const USER_AGENT = `FlockOff/0.1 (+${PROJECT_URL})`;

/**
 * Public privacy policy. The deployed report worker serves the same page at /privacy; set this to
 * that URL before store submission (Play Console wants one stable link). Until then it points at
 * the copy in the repo.
 */
export const PRIVACY_URL = `${PROJECT_URL}/blob/main/docs/privacy-policy.html`;

/**
 * Shared key for signing report requests. Set EXPO_PUBLIC_REPORT_KEY in eas.json env (or .env) to
 * the same value as the worker's REPORT_KEY secret. Anything in an app binary can be extracted, so
 * this is a speed bump against scripted spam, not a wall; the worker's rate limits are the wall.
 */
export const REPORT_KEY = process.env.EXPO_PUBLIC_REPORT_KEY ?? '';

/** Anonymous OSM notes endpoint, used for "report a camera" when the user opts in. */
export const OSM_NOTES_URL = 'https://api.openstreetmap.org/api/0.6/notes';

/** How much map data we pull around the user, and when we pull again. */
export const SYNC_RADIUS_KM = 40;
export const RESYNC_DISTANCE_KM = 15;
export const SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Geofence candidate search radius (we only register the nearest N anyway). */
export const GEOFENCE_SEARCH_RADIUS_KM = 30;
export const BUBBLE_MIN_RADIUS_M = 500;
export const BUBBLE_MAX_RADIUS_M = 15000;

/** Drive mode tuning. */
export const DRIVE_TICK_MIN_MS = 1500;
export const DRIVE_TRAP_POLL_MS = 60 * 1000;
export const DRIVE_TRAP_POLL_RADIUS_KM = 12;
export const DRIVE_RESYNC_CHECK_MS = 5 * 60 * 1000;
export const DRIVE_SPEED_LOOKAHEAD_S = 15;
export const DRIVE_MOVING_SPEED_MPS = 3;
export const DRIVE_AHEAD_MAX_ANGLE = 95;

/** Live speed-trap reports expire after this long unless confirmed. Mirrors the worker. */
export const TRAP_TTL_MS = 2 * 60 * 60 * 1000;
/** Unverified camera reports relayed through the worker live this long unless confirmed. Mirrors the worker. */
export const CAMERA_REPORT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Speed-limit data: a smaller box than cameras because way geometry is heavy. */
export const LIMITS_RADIUS_KM = 15;
export const LIMITS_RESYNC_DISTANCE_KM = 7;
export const LIMITS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LIMITS_MIN_STORED_DROP_MPH = 5;
export const LIMIT_HIGHWAY_CLASSES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
];
/** A limit-drop alert needs your heading within this many degrees of the road's direction into the drop. */
export const LIMIT_DROP_HEADING_TOLERANCE = 60;

export const DB_NAME = 'flockoff.db';

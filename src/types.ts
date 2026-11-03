export type TargetKind = 'alpr' | 'speed_camera' | 'trap' | 'camera_report' | 'limit_drop';

/** A row in the local `cameras` table (fixed infrastructure from OpenStreetMap). */
export type CameraRow = {
  id: string; // "osm-n123456"
  kind: 'alpr' | 'speed_camera';
  lat: number;
  lon: number;
  direction: number | null; // degrees the camera faces, if tagged
  manufacturer: string | null;
  operator: string | null;
  tags: string; // raw OSM tags as JSON, for the detail view
  updated_at: number;
  /** Trip pack (state code) that brought this camera in, if any. */
  pack?: string | null;
};

/** Live community reports cached from the worker: short-lived speed traps and longer-lived unverified cameras. */
export type ReportKind = 'trap' | 'camera';

export type TrapRow = {
  id: string;
  kind: ReportKind;
  lat: number;
  lon: number;
  heading: number | null;
  reported_at: number;
  expires_at: number;
  confirms: number;
  source: 'remote' | 'mine';
};

/** A point where the posted speed limit drops, derived from OpenStreetMap maxspeed tags. */
export type LimitDropRow = {
  id: string; // "ld-<node>-<fromWay>-<toWay>"
  lat: number;
  lon: number;
  from_mph: number;
  to_mph: number;
  heading: number; // direction of travel into the lower limit
  road: string | null;
  updated_at: number;
};

/** Something we can alert on, regardless of where it came from. */
export type Target = {
  id: string;
  kind: TargetKind;
  lat: number;
  lon: number;
  direction: number | null;
  label: string;
  expiresAt?: number;
  manufacturer?: string | null;
  operator?: string | null;
  /** limit_drop only */
  fromMph?: number;
  toMph?: number;
  road?: string | null;
  /** live reports only */
  confirms?: number;
  reportedAt?: number;
};

export type ReportRow = {
  id: string;
  kind: 'alpr' | 'trap';
  lat: number;
  lon: number;
  heading: number | null;
  created_at: number;
  submitted: number; // 0/1
  remote_id: string | null;
  note: string | null;
};

export type AlertRow = {
  id: number;
  target_id: string;
  kind: TargetKind;
  lat: number;
  lon: number;
  distance_m: number;
  fired_at: number;
  seen_at: number | null;
};

export function labelForKind(kind: TargetKind): string {
  switch (kind) {
    case 'alpr':
      return 'Plate reader';
    case 'speed_camera':
      return 'Speed camera';
    case 'trap':
      return 'Speed trap';
    case 'camera_report':
      return 'Possible camera';
    case 'limit_drop':
      return 'Speed limit drop';
  }
}

export function titleForKind(kind: TargetKind): string {
  switch (kind) {
    case 'alpr':
      return 'License plate reader ahead';
    case 'speed_camera':
      return 'Speed camera ahead';
    case 'trap':
      return 'Speed trap reported ahead';
    case 'camera_report':
      return 'Reported plate reader ahead';
    case 'limit_drop':
      return 'Speed limit drops ahead';
  }
}

function isFlock(t: Pick<Target, 'kind' | 'manufacturer'>): boolean {
  return t.kind === 'alpr' && /flock/i.test(t.manufacturer ?? '');
}

/** Name shown in lists and alerts: honest about what the thing is. */
export function displayName(t: Pick<Target, 'kind' | 'manufacturer' | 'toMph'>): string {
  if (isFlock(t)) return 'Flock camera';
  if (t.kind === 'limit_drop' && t.toMph != null) return `Speed limit ${t.toMph}`;
  if (t.kind === 'camera_report') return 'Possible camera';
  return labelForKind(t.kind);
}

/** Label on the dropped map pin: short, and "Flock" for Flock Safety cameras. */
export function pinLabel(t: Pick<Target, 'kind' | 'manufacturer' | 'toMph'>): string {
  if (isFlock(t)) return 'Flock';
  if (t.kind === 'limit_drop' && t.toMph != null) return `Speed limit ${t.toMph}`;
  return labelForKind(t.kind);
}

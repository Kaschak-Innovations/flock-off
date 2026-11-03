import { CAMERA_REPORT_TTL_MS, TRAP_TTL_MS } from '@/config';
import { rejectionMessage, signedHeaders } from '@/data/signing';
import { getActiveTrapsNear, pruneExpiredTraps, removeTrap, updateTrapStatus, upsertTraps } from '@/db/db';
import { getDeviceId, getSettings } from '@/store/settings';
import type { ReportKind, TrapRow } from '@/types';

/**
 * Client for the report worker in ./worker. Two kinds share one mechanism:
 *   trap   — "speed trap here", lives ~2 hours, extended by confirmations
 *   camera — "plate reader here", lives ~14 days, so other drivers are warned long before
 *            an OpenStreetMap mapper gets around to verifying and tagging it
 * Everything degrades gracefully: no URL, no network, or a dead worker means no live reports,
 * never a crash, and the reporter's own phone still keeps what they reported.
 */

type RemoteReport = {
  id: string;
  kind: ReportKind;
  lat: number;
  lon: number;
  heading: number | null;
  reported_at: number;
  expires_at: number;
  confirms: number;
};

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function trapsEnabled(): Promise<boolean> {
  const s = await getSettings();
  return s.trapsApiUrl.trim().length > 0 && (s.includeLiveTraps || s.includeCameraReports);
}

export async function workerConfigured(): Promise<boolean> {
  const s = await getSettings();
  return s.trapsApiUrl.trim().length > 0;
}

/** Pull live reports of both kinds near a point into the local cache. Returns how many are active nearby. */
export async function refreshTrapsNear(lat: number, lon: number, radiusKm: number): Promise<number> {
  const s = await getSettings();
  if (!s.trapsApiUrl.trim() || (!s.includeLiveTraps && !s.includeCameraReports)) return 0;
  const url = `${baseUrl(s.trapsApiUrl)}/reports?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&radius_km=${radiusKm}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Report server responded ${res.status}`);
  const body = (await res.json()) as { reports: RemoteReport[] };
  const rows: TrapRow[] = body.reports.map((t) => ({
    id: t.id,
    kind: t.kind === 'camera' ? 'camera' : 'trap',
    lat: t.lat,
    lon: t.lon,
    heading: t.heading,
    reported_at: t.reported_at,
    expires_at: t.expires_at,
    confirms: t.confirms,
    source: 'remote',
  }));
  await upsertTraps(rows);
  await pruneExpiredTraps();
  return (await getActiveTrapsNear(lat, lon, radiusKm)).length;
}

export type ReportResult = { id: string; expiresAt: number; merged: boolean; offline: boolean };

async function postReport(kind: ReportKind, lat: number, lon: number, heading: number | null): Promise<ReportResult | null> {
  const s = await getSettings();
  if (!s.trapsApiUrl.trim()) return null;
  const deviceId = await getDeviceId();
  const url = `${baseUrl(s.trapsApiUrl)}/reports`;
  const payload = JSON.stringify({ kind, lat, lon, heading, device_id: deviceId });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await signedHeaders(url, 'POST', payload)) },
      body: payload,
    });
  } catch {
    return null; // no network: the caller keeps the report locally
  }
  const rejected = rejectionMessage(res.status);
  if (rejected) throw new Error(rejected); // the server answered and said no; "saved offline" would be a lie
  if (!res.ok) return null;
  try {
    const body = (await res.json()) as { id: string; expires_at: number; merged: boolean };
    await upsertTraps([
      { id: body.id, kind, lat, lon, heading, reported_at: Date.now(), expires_at: body.expires_at, confirms: 1, source: 'mine' },
    ]);
    return { id: body.id, expiresAt: body.expires_at, merged: body.merged, offline: false };
  } catch {
    return null;
  }
}

/**
 * Report a speed trap. If the worker is unreachable the report is still cached locally so the
 * reporter gets their own alert on the way back, and the result is flagged offline.
 */
export async function reportTrap(lat: number, lon: number, heading: number | null): Promise<ReportResult> {
  const remote = await postReport('trap', lat, lon, heading);
  if (remote) return remote;
  const now = Date.now();
  const localId = `local-${now}`;
  await upsertTraps([{ id: localId, kind: 'trap', lat, lon, heading, reported_at: now, expires_at: now + TRAP_TTL_MS, confirms: 1, source: 'mine' }]);
  return { id: localId, expiresAt: now + TRAP_TTL_MS, merged: false, offline: true };
}

/**
 * Relay a camera sighting to other drivers. Returns null when no worker is configured; the
 * OpenStreetMap note path in reports.ts is independent of this.
 */
export async function reportCameraRemote(lat: number, lon: number, heading: number | null): Promise<ReportResult | null> {
  if (!(await workerConfigured())) return null;
  // The OSM note is the primary path for cameras; a relay rejection should not sink it.
  const remote = await postReport('camera', lat, lon, heading).catch(() => null);
  if (remote) return remote;
  const now = Date.now();
  const localId = `local-cam-${now}`;
  await upsertTraps([
    { id: localId, kind: 'camera', lat, lon, heading, reported_at: now, expires_at: now + CAMERA_REPORT_TTL_MS, confirms: 1, source: 'mine' },
  ]);
  return { id: localId, expiresAt: now + CAMERA_REPORT_TTL_MS, merged: false, offline: true };
}

export async function voteTrap(id: string, vote: 'still' | 'gone'): Promise<void> {
  const s = await getSettings();
  if (id.startsWith('local-') || !s.trapsApiUrl.trim()) {
    if (vote === 'gone') await removeTrap(id);
    return;
  }
  const deviceId = await getDeviceId();
  const url = `${baseUrl(s.trapsApiUrl)}/reports/${encodeURIComponent(id)}/vote`;
  const payload = JSON.stringify({ vote, device_id: deviceId });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await signedHeaders(url, 'POST', payload)) },
    body: payload,
  });
  if (!res.ok) throw new Error(rejectionMessage(res.status) ?? `Vote failed (${res.status})`);
  const body = (await res.json()) as { expires_at: number; confirms: number; active: boolean };
  if (!body.active) {
    await removeTrap(id);
  } else {
    await updateTrapStatus(id, body.expires_at, body.confirms);
  }
}

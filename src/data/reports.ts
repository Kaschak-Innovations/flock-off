import * as Crypto from 'expo-crypto';

import { OSM_NOTES_URL, USER_AGENT } from '@/config';
import { reportCameraRemote } from '@/data/traps';
import { insertReport, markReportSubmitted } from '@/db/db';
import { getSettings } from '@/store/settings';
import type { ReportRow } from '@/types';

/**
 * "Report a camera here" is deliberately low-friction: we save the fix locally and, if the user
 * opted in, open an anonymous OpenStreetMap note at that spot. DeFlock mappers watch for these
 * and promote them to proper tagged nodes, which then flow back into every app using the data,
 * including this one. Direct tagging via OSM OAuth is the obvious next step (see README roadmap).
 */

export type ReportCameraResult = {
  reportId: string;
  noteId: string | null;
  noteSubmitted: boolean;
  /** Relay through the worker: null when no server is configured. */
  relay: { merged: boolean; offline: boolean } | null;
  error?: string;
};

export async function reportCameraHere(
  lat: number,
  lon: number,
  heading: number | null,
  accuracyM: number | null,
): Promise<ReportCameraResult> {
  const settings = await getSettings();
  const now = Date.now();
  const reportId = Crypto.randomUUID();
  const row: ReportRow = {
    id: reportId,
    kind: 'alpr',
    lat,
    lon,
    heading,
    created_at: now,
    submitted: 0,
    remote_id: null,
    note: null,
  };
  await insertReport(row);

  // Other drivers get warned right away; the OSM note below is the slow, verified path.
  const relayResult = await reportCameraRemote(lat, lon, heading);
  const relay = relayResult ? { merged: relayResult.merged, offline: relayResult.offline } : null;

  if (!settings.submitOsmNotes) {
    return { reportId, noteId: null, noteSubmitted: false, relay };
  }

  const facing = heading != null ? ` Reporter was heading about ${Math.round(heading)} degrees.` : '';
  const acc = accuracyM != null ? ` GPS accuracy about ${Math.round(accuracyM)} m.` : '';
  const text =
    `Possible ALPR camera (Flock Safety style pole camera) observed here.${facing}${acc} ` +
    `Reported via the Flock Off app. Please verify on the ground and tag as ` +
    `man_made=surveillance + surveillance:type=ALPR + manufacturer=Flock Safety (see deflock.me/identify).`;

  try {
    const url = `${OSM_NOTES_URL}?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&text=${encodeURIComponent(text)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' } });
    if (!res.ok) throw new Error(`OSM notes API responded ${res.status}`);
    const xml = await res.text();
    const match = xml.match(/<id>(\d+)<\/id>/);
    const noteId = match ? match[1] : null;
    await markReportSubmitted(reportId, noteId, 'osm-note');
    return { reportId, noteId, noteSubmitted: true, relay };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { reportId, noteId: null, noteSubmitted: false, relay, error: message };
  }
}

export function osmNoteUrl(noteId: string): string {
  return `https://www.openstreetmap.org/note/${noteId}`;
}

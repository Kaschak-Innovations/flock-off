import * as Crypto from 'expo-crypto';

import { REPORT_KEY } from '@/config';

/**
 * Request signing for the report worker. The worker, when its REPORT_KEY secret is set, requires
 * every POST to carry:
 *   X-Flock-Ts   the sender's clock in ms
 *   X-Flock-Sig  hex HMAC-SHA256(key, `${ts}.${METHOD}.${path}.${body}`)
 * and rejects anything older than five minutes. Hermes has no crypto.subtle, so the HMAC is built
 * here on expo-crypto's SHA-256 digest (RFC 2104, 64-byte block).
 *
 * This proves the request came from a build that holds the key, which keeps scripted spam out.
 * It is not proof of a genuine phone: anyone who unpacks the APK can read the key. The worker's
 * rate limits assume that; device attestation is the upgrade path, see README.
 */

const BLOCK_BYTES = 64;
const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

/** UTF-8 bytes in a fresh ArrayBuffer (TextEncoder's return type is looser than expo-crypto accepts). */
function utf8(text: string): Bytes {
  return new Uint8Array(encoder.encode(text));
}

async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data));
}

function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toHex(bytes: Bytes): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  let keyBytes = utf8(key);
  if (keyBytes.length > BLOCK_BYTES) keyBytes = await sha256(keyBytes);
  const padded = new Uint8Array(BLOCK_BYTES);
  padded.set(keyBytes);
  const inner = await sha256(concat(padded.map((b) => b ^ 0x36), utf8(message)));
  const outer = await sha256(concat(padded.map((b) => b ^ 0x5c), inner));
  return toHex(outer);
}

/** True when this build carries a signing key. */
export function signingEnabled(): boolean {
  return REPORT_KEY.length > 0;
}

/** Headers for a signed request, or none when the build has no key. */
export async function signedHeaders(url: string, method: string, body: string): Promise<Record<string, string>> {
  if (!signingEnabled()) return {};
  const ts = String(Date.now());
  const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
  const sig = await hmacSha256Hex(REPORT_KEY, `${ts}.${method.toUpperCase()}.${path}.${body}`);
  return { 'X-Flock-Ts': ts, 'X-Flock-Sig': sig };
}

/** Turn a worker rejection into something a driver can act on. Returns null for statuses that are not rejections. */
export function rejectionMessage(status: number): string | null {
  if (status === 401) {
    return signingEnabled()
      ? 'The report server rejected this build of the app. Its signing key does not match the server.'
      : 'The report server requires a signed app build. This build has no signing key.';
  }
  if (status === 429) return 'Too many reports from here right now. Try again in a minute.';
  return null;
}

// Downloading a file on behalf of a mod.
//
// This exists because the renderer cannot do it: Slack's CDN serves avatars
// without CORS headers, so `fetch('https://ca.slack-edge.com/…')` from the page
// fails even though an <img> with the same URL loads. Node has no such rule.
//
// It is also a capability worth keeping narrow, since it writes to disk on a
// mod's say-so. Everything below is a constraint a reviewer can check:
//
//   - https only, so a mod cannot read file:// or reach a local service
//   - the file name is reduced to a safe basename; no path can escape the
//     download directory
//   - a size cap, so a mod cannot fill the disk
//   - one fixed directory, overridable by the user, never by the mod

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export const DOWNLOAD_DIR =
  process.env.BETTERSLACK_DOWNLOAD_DIR ?? path.join(homedir(), 'Downloads');

export class DownloadError extends Error {}

/**
 * Reduce whatever a mod asked for to a plain file name.
 * Exported for the tests: this is the part that must not be got wrong.
 */
export function safeFilename(input: string): string {
  // basename() first, so "../../x" cannot survive as a path at all.
  const base = path.basename(String(input ?? '').trim());
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-]+/, '')
    .slice(0, 120);
  return cleaned || 'betterslack-download';
}

/** Add " (2)", " (3)"… rather than overwriting a file the user already has. */
async function uniquePath(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let n = 0; n < 100; n++) {
    const candidate = path.join(dir, n === 0 ? filename : `${stem} (${n + 1})${ext}`);
    try {
      await fs.access(candidate);
    } catch {
      return candidate;
    }
  }
  throw new DownloadError('too many files with that name already');
}

export interface DownloadResult {
  path: string;
  bytes: number;
}

export async function downloadFile(url: string, filename: string): Promise<DownloadResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DownloadError('not a valid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new DownloadError(`refusing to download over ${parsed.protocol || 'an unknown scheme'}`);
  }

  const response = await fetch(parsed.href, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new DownloadError(`HTTP ${response.status}`);

  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    throw new DownloadError(`file is ${Math.round(declared / 1024 / 1024)} MB, over the 25 MB cap`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  // Checked again: content-length is a claim, not a guarantee.
  if (buffer.byteLength > MAX_BYTES) throw new DownloadError('file exceeded the 25 MB cap');

  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  const target = await uniquePath(DOWNLOAD_DIR, safeFilename(filename));
  await fs.writeFile(target, buffer);

  return { path: target, bytes: buffer.byteLength };
}

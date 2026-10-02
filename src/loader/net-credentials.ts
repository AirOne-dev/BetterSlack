// The secret a mod's `api.net` requests carry, kept where the page cannot read it.
//
// A server that wants a token in a header -- GitLab's `PRIVATE-TOKEN` -- cannot
// be reached with `api.net` as it stands, because no header is the mod's to
// choose, and a token in the address would end up in the server's access log.
// So the mod hands the secret to the loader once and the loader attaches it.
//
// What makes that safe to offer to every plugin, which all share one page:
//
//   - **write-only.** There is no call that returns the secret: the page can
//     set it, clear it and ask whether one is held, and that is all. A mod that
//     is compromised later cannot read what an earlier session stored.
//   - **bound to an origin.** The secret is stored with the origin of the
//     address it was given for, and `net.ts` attaches it only to a request for
//     that origin. Code that rewrites the mod's address setting to somewhere
//     else makes the loader send nothing, not the token.
//   - **only for a mod that asked.** The manifest has to declare a
//     `credential`, and the address has to be one of its `network` settings at
//     the moment it is stored.
//   - **not in settings.json, and not in the data folder.** settings.json is
//     copied whole into every backup, embedded in the script that starts every
//     page and sent to every window; the data folder is readable by the mod's
//     own page. This is a file of its own, readable by the user only, and no
//     backup, no push and no bridge call includes it.
//
// It is still a plain file, not a keychain entry: protect it like the token it
// holds. Uninstalling the mod removes it; so does `clear`.
//
// Nothing here logs a value, and no error carries one.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ModRecord, NetCredentialResult } from '../shared/protocol.js';
import { allowedBases, within, type StoredCredential } from './net.js';
import { USER_ROOT } from './store.js';

const ROOT = path.join(USER_ROOT, 'credentials');
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,48}$/;
/** Visible ASCII only: what travels in a header, and nothing that could end one. */
const SECRET_PATTERN = /^[\x21-\x7e]{1,4096}$/;

function fileOf(id: string): string | null {
  return ID_PATTERN.test(id) ? path.join(ROOT, `${id}.json`) : null;
}

/** What is stored for a mod, or null: missing, unreadable and malformed are all "none". */
export async function readCredential(id: string): Promise<StoredCredential | null> {
  const file = fileOf(id);
  if (!file) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<StoredCredential> | null;
    return typeof parsed?.origin === 'string' && typeof parsed.secret === 'string' && parsed.secret
      ? { origin: parsed.origin, secret: parsed.secret }
      : null;
  } catch {
    return null;
  }
}

/** True when there was something to remove. */
export async function removeCredential(id: string): Promise<boolean> {
  const file = fileOf(id);
  if (!file) return false;
  return fs.unlink(file).then(() => true, () => false);
}

/** Whether what is held is for an origin the mod's settings name right now. */
function holds(record: ModRecord, values: Record<string, unknown>, stored: StoredCredential | null): boolean {
  return Boolean(stored) && allowedBases(record, values).some((base) => base.origin === stored!.origin);
}

/**
 * Keep a secret for the address the mod gave.
 *
 * The address must be one its `network` settings hold *now*, so a secret can
 * only be bound to an origin the user can read on the mod's page.
 */
export async function setCredential(
  record: ModRecord | undefined,
  enabled: boolean,
  values: Record<string, unknown>,
  secret: unknown,
  address: unknown,
): Promise<NetCredentialResult> {
  if (!record || record.type !== 'plugin' || !enabled || !record.network?.credential) {
    return { ok: false, error: 'blocked' };
  }
  const file = fileOf(record.id);
  if (!file) return { ok: false, error: 'blocked' };
  let url: URL;
  try {
    url = new URL(String(address));
  } catch {
    return { ok: false, error: 'blocked' };
  }
  if (!allowedBases(record, values).some((base) => within(url, base))) return { ok: false, error: 'blocked' };
  if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return { ok: false, error: 'invalid' };

  await fs.mkdir(ROOT, { recursive: true, mode: 0o700 });
  // Written beside and renamed over, with the mode set when the file is
  // created: there is never a moment it exists readable by anybody else.
  const temporary = `${file}.${process.pid}.partial`;
  await fs.writeFile(temporary, JSON.stringify({ origin: url.origin, secret }), { mode: 0o600 });
  await fs.rename(temporary, file);
  return { ok: true, has: true };
}

export async function clearCredential(record: ModRecord | undefined): Promise<NetCredentialResult> {
  if (!record || record.type !== 'plugin') return { ok: false, error: 'blocked' };
  await removeCredential(record.id);
  return { ok: true, has: false };
}

export async function hasCredential(
  record: ModRecord | undefined,
  enabled: boolean,
  values: Record<string, unknown>,
): Promise<NetCredentialResult> {
  if (!record || record.type !== 'plugin' || !enabled || !record.network?.credential) {
    return { ok: false, error: 'blocked' };
  }
  return { ok: true, has: holds(record, values, await readCredential(record.id)) };
}

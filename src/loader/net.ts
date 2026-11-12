// Making an HTTP request on a mod's behalf.
//
// A page cannot read the answer of a server that sends no CORS headers: the
// request leaves, the server acts on it, and the page is handed nothing it can
// open. Node has no such rule, so `api.net` has the loader make the request --
// the same reason `file.download` exists, and kept as narrow.
//
// The `network` declaration is a contract for the reviewer, not a sandbox.
// Every plugin runs in the same page and the page can write any mod's
// settings, so code in the page can point an allowed setting anywhere; what
// the rules below buy is that a mod written to them talks only where its
// manifest and its settings say, which a reviewer checks in one line. The
// rules themselves are enforced:
//
//   - only to an address held by one of the settings the manifest names under
//     `network`, read at request time -- the user typed it, and the panel shows
//     it -- and only at that path or below it
//   - https only, no credentials in the URL, and no redirect followed: a 3xx
//     comes back as a status, because following one leaves the address the
//     setting holds
//   - no cookies (Node's fetch keeps none) and no header the mod chooses; the
//     one exception is a credential, which the mod never holds: it hands the
//     secret to the loader once and the loader attaches it, as the single
//     header the manifest names, to a request for the origin the secret was
//     stored for -- so an address moved to another origin is sent nothing
//   - a form body or none, capped; an answer capped and parsed as JSON
//   - nothing about the request is logged, since the form is where a password
//     travels, and a failure is a value rather than a thrown error so the
//     loader's own "request failed" line has nothing to print either

import {
  NET_TIMEOUT_MS,
  type ModRecord,
  type NetCredentialSpec,
  type NetError,
  type NetResult,
} from '../shared/protocol.js';

const MAX_ANSWER_BYTES = 4 * 1024 * 1024;
const MAX_FORM_BYTES = 64 * 1024;
const MAX_FORM_FIELDS = 50;

export interface NetRequest {
  url: unknown;
  method?: unknown;
  form?: unknown;
}

function httpsUrl(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url;
}

/** What the mod's `network` settings hold right now, as addresses. */
export function allowedBases(record: ModRecord, values: Record<string, unknown>): URL[] {
  const bases: URL[] = [];
  for (const key of record.network?.settings ?? []) {
    const declared = record.settings?.find((field) => field.key === key);
    const value = key in values ? values[key] : declared?.default;
    if (typeof value !== 'string' || !value.trim()) continue;
    const base = httpsUrl(value.trim());
    if (base) bases.push(base);
  }
  return bases;
}

/**
 * Same origin, and the base's path or something under it.
 *
 * "Under" means past a slash: `/api` covers `/api` and `/api/x`, never
 * `/api-admin`. The URL parser has already folded `..` and its escaped forms
 * away by the time this compares anything -- but not an escaped slash, which
 * a server that decodes before it normalises turns back into one, so
 * `/api/..%2Fadmin` would reach `/admin` there. A path with one is refused.
 */
export function within(url: URL, base: URL): boolean {
  if (url.origin !== base.origin) return false;
  if (/%2f|%5c/i.test(url.pathname)) return false;
  if (url.pathname === base.pathname) return true;
  const folder = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  return url.pathname.startsWith(folder);
}

function isForm(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_FORM_FIELDS
    && entries.every(([key, field]) => key !== '' && typeof field === 'string');
}

class TooLarge extends Error {}

const failure = (error: NetError): NetResult => ({ error });

/** A secret and the one origin it may be sent to. */
export interface StoredCredential {
  origin: string;
  secret: string;
}

/**
 * Headers a credential may not be written into: they are the transport's, the
 * browser's identity or the session's, and a secret there either breaks the
 * request or becomes somebody else's cookie. Everything else is the manifest's
 * to name, so a service nobody here has heard of needs no change to this file.
 */
const FORBIDDEN_HEADERS = new Set([
  'host', 'cookie', 'set-cookie', 'origin', 'referer', 'user-agent', 'connection', 'upgrade',
  'transfer-encoding', 'te', 'trailer', 'expect', 'keep-alive', 'via', 'forwarded',
  'accept', 'accept-encoding', 'accept-language', 'content-type', 'content-length',
  'content-encoding', 'location', 'dnt',
]);

/** The manifest's `network.credential`, if it is one the loader would send. */
export function parseCredentialSpec(value: unknown): NetCredentialSpec | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { header, prefix, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof header !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(header)) return null;
  const name = header.toLowerCase();
  if (FORBIDDEN_HEADERS.has(name) || name.startsWith('proxy-') || name.startsWith('sec-')) return null;
  if (prefix !== undefined && (typeof prefix !== 'string' || !/^[\x21-\x7e]{1,31} ?$/.test(prefix))) return null;
  return prefix === undefined ? { header: name } : { header: name, prefix };
}

/**
 * The header a secret travels in, or nothing when it may not be sent.
 *
 * Both halves have to agree: the manifest has to ask for a credential, and the
 * one held has to be for the origin being reached. A secret kept for
 * `https://a.example` is never attached to a request for `https://b.example`,
 * which is what a setting rewritten by somebody else's code would produce.
 */
export function credentialHeader(
  spec: NetCredentialSpec | undefined,
  stored: StoredCredential | null | undefined,
  url: URL,
): Record<string, string> {
  if (!spec || !stored || stored.origin !== url.origin || !stored.secret) return {};
  return { [spec.header]: `${spec.prefix ?? ''}${stored.secret}` };
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

/** The body as text, refusing to hold more than `max` bytes of it. */
async function readCapped(response: Response, max: number): Promise<string> {
  // A claim, not a guarantee, so it is only a way to refuse early.
  if (Number(response.headers.get('content-length') ?? '0') > max) {
    await response.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  // Not Buffer: the API page runs this same function in a browser.
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Make the request, or say why not.
 *
 * `enabled` and `values` are the settings file at the moment of asking: a mod
 * that is switched off reaches nothing, and the address is whatever its
 * `network` settings hold now.
 */
export async function netRequest(
  record: ModRecord | undefined,
  enabled: boolean,
  values: Record<string, unknown>,
  request: NetRequest,
  fetchImpl: typeof fetch = fetch,
  credential: StoredCredential | null = null,
): Promise<NetResult> {
  if (!record || record.type !== 'plugin' || !enabled) return failure('blocked');
  const url = typeof request.url === 'string' ? httpsUrl(request.url) : null;
  if (!url) return failure('blocked');
  url.hash = '';
  if (!allowedBases(record, values).some((base) => within(url, base))) return failure('blocked');

  const method = request.method ?? (request.form === undefined ? 'GET' : 'POST');
  if (method !== 'GET' && method !== 'POST') return failure('invalid');
  let body: string | undefined;
  if (request.form !== undefined) {
    if (method !== 'POST' || !isForm(request.form)) return failure('invalid');
    // Percent-encoded, so every character is one byte.
    body = new URLSearchParams(request.form).toString();
    if (body.length > MAX_FORM_BYTES) return failure('invalid');
  }

  let response: Response;
  try {
    response = await fetchImpl(url.href, {
      method,
      body,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
        ...credentialHeader(record.network?.credential, credential, url),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    });
  } catch (err) {
    return failure(isTimeout(err) ? 'timeout' : 'network');
  }

  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, json: null };
  }
  try {
    return { status: response.status, json: parseJson(await readCapped(response, MAX_ANSWER_BYTES)) };
  } catch (err) {
    if (err instanceof TooLarge) return failure('too-large');
    return failure(isTimeout(err) ? 'timeout' : 'network');
  }
}

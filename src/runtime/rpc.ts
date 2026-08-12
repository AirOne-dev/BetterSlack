// Renderer half of the bridge to the loader.
//
// Outbound goes through the CDP binding the loader registered on `window`;
// inbound arrives as a call to `window.__slackmodRecv` driven by
// Runtime.evaluate. Both sides speak JSON strings.

import {
  BINDING_NAME,
  RECEIVER_NAME,
  type Envelope,
  type Event as PushEvent,
  type Request,
} from '../shared/protocol.js';

type Resolver = { resolve: (value: unknown) => void; reject: (err: Error) => void };

const REQUEST_TIMEOUT_MS = 15_000;

export class Bridge {
  private nextRid = 1;
  private pending = new Map<number, Resolver>();
  private listeners = new Set<(event: PushEvent) => void>();

  constructor() {
    (window as unknown as Record<string, unknown>)[RECEIVER_NAME] = (raw: string) => {
      this.onMessage(raw);
    };
  }

  get available(): boolean {
    return typeof (window as unknown as Record<string, unknown>)[BINDING_NAME] === 'function';
  }

  private onMessage(raw: string): void {
    let envelope: Envelope;
    try {
      envelope = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    if (envelope.rid === undefined) {
      for (const listener of [...this.listeners]) {
        try {
          listener(envelope.payload as PushEvent);
        } catch (err) {
          console.error('[slackmod] event listener threw', err);
        }
      }
      return;
    }
    const slot = this.pending.get(envelope.rid);
    if (!slot) return;
    this.pending.delete(envelope.rid);
    const { result, error } = (envelope.payload ?? {}) as { result?: unknown; error?: string };
    if (error) slot.reject(new Error(error));
    else slot.resolve(result);
  }

  onEvent(listener: (event: PushEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request<T = unknown>(payload: Request): Promise<T> {
    const send = (window as unknown as Record<string, unknown>)[BINDING_NAME];
    if (typeof send !== 'function') {
      return Promise.reject(new Error('SlackMod loader is not attached'));
    }
    const rid = this.nextRid++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        reject(new Error(`loader did not answer "${payload.type}" within ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(rid, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      (send as (payload: string) => void)(JSON.stringify({ rid, payload } satisfies Envelope));
    });
  }

  /** Fire-and-forget; used for logging so it can never deadlock the caller. */
  notify(payload: Request): void {
    const send = (window as unknown as Record<string, unknown>)[BINDING_NAME];
    if (typeof send !== 'function') return;
    (send as (payload: string) => void)(JSON.stringify({ payload } satisfies Envelope));
  }
}

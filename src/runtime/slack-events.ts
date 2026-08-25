/**
 * Slack's own realtime events, as something a mod can listen to.
 *
 * Slack keeps a socket per workspace and pushes everything that happens in
 * every conversation you are in down it -- a message, an edit, a deletion, a
 * reaction -- whether or not that conversation is open. Measured against a
 * live client: a message for a channel in a workspace the window was not even
 * showing arrived while the client sat on another one. It is how the unread
 * badges in the sidebar move without you looking at them.
 *
 * **The page cannot see it, and this is not for want of trying.** Slack's own
 * bundle opens the socket before anything else runs, so patching `WebSocket`
 * in the renderer catches nothing. The loader reads the frames off the
 * debugging protocol, where they are visible whatever the bundle does, and
 * pushes them here.
 *
 * **Listening is not reading.** Slack marks a conversation read when its
 * client sends `conversations.mark`; being told a message exists sends
 * nothing. A mod that watches every conversation this way leaves every unread
 * exactly as it was, which is the whole reason this exists rather than a mod
 * opening conversations to look at them.
 *
 * The filter is the point of the shape below. Nothing is forwarded until a mod
 * asks for a type, and the loader does not even switch its tap on before then,
 * so a client whose mods do not listen pays nothing at all.
 */

import type { Bridge } from './rpc.js';
import type { SlackEvent } from '../shared/protocol.js';

export type SlackEventHandler = (event: SlackEvent) => void;

export interface SlackEvents {
  /**
   * Listen for one or more of Slack's event types. Returns a cleanup.
   *
   * The types are Slack's own: `message` (with `subtype` `message_changed` or
   * `message_deleted`), `reaction_added`, `reaction_removed`, and the rest of
   * what its client acts on.
   */
  on(types: string[], handler: SlackEventHandler): () => void;
  /** Hand an event from the loader to whoever asked for it. */
  deliver(event: SlackEvent): void;
  /** Every type currently asked for, which is what the loader is told. */
  watching(): string[];
}

export function createSlackEvents(bridge: Pick<Bridge, 'request'>): SlackEvents {
  const subscriptions = new Set<{ types: Set<string>; handler: SlackEventHandler }>();
  let told = '';

  /*
   * Told once per change, and never on every subscription.
   *
   * Two mods starting in the same tick would otherwise send two filters, and
   * the loader would switch its tap on twice; a mod stopping would send a
   * third. The set is compared as text because that is what matters -- the
   * same types in another order is the same filter.
   */
  const publish = (): void => {
    const types = watching();
    const key = types.join(',');
    if (key === told) return;
    told = key;
    void bridge.request({ type: 'slack.watch', types }).catch(() => {
      // A loader that will not take the filter is a loader that sends nothing,
      // which is the state this was in before anybody asked. Nothing to say.
      told = '';
    });
  };

  const watching = (): string[] => {
    const all = new Set<string>();
    for (const sub of subscriptions) for (const type of sub.types) all.add(type);
    return [...all].sort();
  };

  return {
    watching,
    on(types, handler) {
      const sub = { types: new Set(types.filter(Boolean)), handler };
      subscriptions.add(sub);
      publish();
      return () => {
        subscriptions.delete(sub);
        publish();
      };
    },
    deliver(event) {
      if (typeof event?.type !== 'string') return;
      for (const sub of [...subscriptions]) {
        if (!sub.types.has(event.type)) continue;
        try {
          sub.handler(event);
        } catch (err) {
          // One mod throwing on an event must not stop the next mod hearing it.
          console.error('[betterslack] a listener threw on a Slack event:', err);
        }
      }
    },
  };
}

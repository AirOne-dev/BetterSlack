---
name: onEvent
group: slack
title: Slack
signature: (types: string[], handler: (event: SlackEvent) => void): Cleanup
since: unreleased
preview: slack-onevent
control: kind | select | message_deleted | event | message, message_changed, message_deleted, reaction_added, reaction_removed
---

Slack keeps a socket per workspace and pushes everything that happens in every conversation you are in down it — a message, an edit, a deletion, a reaction — whether or not that conversation is open. It is how the unread badges in the sidebar move without you looking at them, and it is the only way for a mod to know about a conversation it is not in front of without asking Slack for it one conversation at a time.

**Listening is not reading.** Slack marks a conversation read when its client sends `conversations.mark`; being told that a message exists sends nothing at all. A mod can watch every conversation you are in and leave every unread exactly where it was.

The types are Slack's own, and the frame is passed through as Slack sent it: `message` with a `subtype` of `message_changed` or `message_deleted` carries `previous_message` alongside `message`, and a reaction carries the message it is about in `item`. Nothing is forwarded until something asks — the loader does not switch its tap on before the first listener — and only the types asked for cross the bridge.

The page cannot do this for itself: Slack's own bundle opens the socket before anything else runs, so patching `WebSocket` in the renderer catches nothing. The loader reads the frames off the debugging protocol, where they are visible whatever the bundle does.

```js
api.slack.onEvent(['message', 'reaction_removed'], (event) => {
  if (event.subtype === 'message_deleted') {
    keep(event.channel, event.deleted_ts, event.previous_message?.text);
  }
});
```

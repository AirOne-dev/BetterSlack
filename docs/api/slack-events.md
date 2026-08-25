---
name: events
group: slack
title: Slack
signature: SlackEvents — on, onMessage, onMessageChanged, onMessageDeleted, onReaction, onMembership, onConversation, onUserChanged, onPresence, onTyping, onRead, onPin, onSaved, onEmojiChanged
since: 3.2.0
preview: slack-events
control: listener | select | onMessageDeleted | listener | onMessage, onMessageChanged, onMessageDeleted, onReaction, onMembership, onConversation, onUserChanged, onPresence
---

Slack keeps a socket per workspace and pushes everything that happens in every conversation you are in down it — a message, an edit, a deletion, a reaction, somebody's status, somebody joining — whether or not that conversation is open. It is how the unread badges in the sidebar move without you looking at them, and it is the only way for a mod to know about a conversation it is not in front of without asking Slack for it one at a time.

**Listening is not reading.** Slack marks a conversation read when its client sends `conversations.mark`; being told that a message exists sends nothing at all. A mod can watch every conversation you are in and leave every unread exactly where it was.

Each listener hands over what the event is *about* rather than Slack's frame: an edit carries both wordings, a deletion carries what the message said, a reaction carries the message it is on rather than the moment it happened. `raw` is always there for what a shape leaves out, and `on(types, handler)` is the escape hatch — Slack pushes far more than this names. Every one returns a cleanup, and all of them are torn down with the plugin.

Two things done for you. `onMessageChanged` only fires when the words actually moved, because Slack sends `message_changed` when an unfurl attaches too. And nothing at all is forwarded until a mod asks: the loader does not switch its tap on before the first listener, and only the types asked for cross the bridge.

```js
api.slack.events.onMessageDeleted((gone) => {
  keep(gone.channelId, gone.ts, gone.userId, gone.text);
});

api.slack.events.onReaction(({ added, channelId, ts, emoji, userId }) => {
  if (!added) note(`${userId} took :${emoji}: back`);
});
```

---
name: cache
group: helpers
title: api.helpers
signature: (name: string, options?: { keys?: number }): Cache
preview: helpers-cache
control: stored | text | the list you saw last time | what is stored
control: fresh | text | the list Slack just answered | what Slack answers
---

A cache that survives a restart and refreshes itself behind you.

Both mods that list people had the same shape: ask Slack, wait, draw. The answer is nearly always the one from last time, so the waiting is spent confirming what was already known — and after a restart there is nothing to confirm against, so every list starts empty. Measured on a live client: a member column took **805ms** to show anybody, and **81ms** from the cache.

`swr` hands back what is stored, synchronously, and goes to the network anyway. Your callback runs *only if the answer differs* from what was stored, so a list that has not changed never repaints and one that has does not stay wrong.

It is stored through `api.settings`, a file the loader owns, which is why it is there at the next launch — and why `keys` exists. That file is read at every start, so a cache that grows without limit becomes a slower start than the network it replaced. The oldest keys go first. Pass a smaller number when the values are big: the member column keeps twelve channels, the palette four workspaces.

```js
const store = api.helpers.cache('members', { keys: 12 });

// Draw what you have, then let it correct itself.
const held = store.swr(channelId, () => fetchMembers(channelId), (fresh) => paint(fresh));
if (held) paint(held);
```

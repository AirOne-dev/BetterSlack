---
name: cache
group: helpers
title: api.helpers
signature: (name: string, options?: { keys?: number }): Cache
since: 2.1.0
preview: helpers-cache
control: stored | text | the list you saw last time | what is stored
control: fresh | text | the list Slack just answered | what Slack answers
---

A cache that survives a restart and refreshes itself in the background.

`swr` hands back what is stored, synchronously, and asks the network anyway. Your callback runs *only if the answer differs* from what was stored, so a list that has not changed never repaints and one that has does not stay wrong. A list drawn from the cache is on screen in tens of milliseconds, where the network takes most of a second.

It is stored through `api.settings`, a file the loader reads at every start, so a cache that grows without limit slows every launch. `keys` caps it, oldest first: pass a smaller number when the values are big.

```js
const store = api.helpers.cache('members', { keys: 12 });

// Draw what you have, then let it correct itself.
const held = store.swr(channelId, () => fetchMembers(channelId), (fresh) => paint(fresh));
if (held) paint(held);
```

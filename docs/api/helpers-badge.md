---
name: badge
group: helpers
title: api.helpers
signature: (selector: string, id: string, value: () => string | number | null): Cleanup
since: 2.0.1
preview: helpers-badge
control: value | number | 3
---

A small count or dot pinned to any element, kept in sync by a getter rather than by you remembering to redraw it. Return null from the getter and the badge goes away.

```js
let unread = 0;
api.helpers.badge('[data-qa="betterslack_notes_button"]', 'unread', () => unread || null);
// return null to take the badge away
```

---
name: badge
group: helpers
title: api.helpers
signature: (selector: string, id: string, value: () => string | number | null): Cleanup
preview: helpers-badge
control: value | number | 3
---

A small count/dot badge pinned to any element, kept in sync by a getter.

```js
let unread = 0;
api.helpers.badge('[data-qa="betterslack_notes_button"]', 'unread', () => unread || null);
// return null to take the badge away
```

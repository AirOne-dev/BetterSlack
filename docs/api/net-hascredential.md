---
name: hasCredential
group: net
title: api.net
signature: (): Promise<boolean>
since: unreleased
preview: net-hascredential
---

Whether a secret is held for the address the mod's settings name right now. A secret stored for another origin is not held for this one, so changing the address reads as signed out. It tells you whether there is a secret, never what it is.

```js
if (!(await api.net.hasCredential())) showSignIn();
```

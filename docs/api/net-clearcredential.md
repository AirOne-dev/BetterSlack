---
name: clearCredential
group: net
title: api.net
signature: (): Promise<{ ok: true; has: false } | { ok: false; error: 'blocked' }>
since: unreleased
preview: net-clearcredential
---

Forget the secret `setCredential` stored. Requests carry no header from then on. Signing out is this call, and so is a token the server has refused.

```js
await api.net.clearCredential();
```

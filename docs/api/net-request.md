---
name: request
group: net
title: api.net
signature: (url: string, options?: { method?: 'GET' | 'POST'; form?: Record<string, string> }): Promise<NetResult>
since: unreleased
preview: net-request
control: base | text | https://hours.example.com/api/ | address in the setting
control: url | text | https://hours.example.com/api/ | address asked for
---

One request to a server that sends no CORS headers, made by the loader because a page can never read such a server's answer.
Only to an address held by one of
the settings the manifest names under `network` -- typed by the user and shown
in the panel -- or somewhere under it; over https, with a form body or none, no
cookies and no redirect followed. The answer is `{ status, json }`, and a
failure is `{ error }` (`blocked`, `invalid`, `timeout`, `network`,
`too-large`) rather than a rejection.

```js
// mod.json: a text setting "apiUrl", and "network": { "settings": ["apiUrl"] }
const answer = await api.net.request(api.settings.get('apiUrl'), {
  method: 'POST',
  form: { username, token },
});
if ('error' in answer) return showOffline(answer.error);
if (answer.status === 401) return signOut();
render(answer.json);
```

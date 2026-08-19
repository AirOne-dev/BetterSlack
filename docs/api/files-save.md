---
name: save
group: files
title: api.files
signature: (url: string, filename: string): Promise<{ path: string; bytes: number }>
preview: files-save
control: url | text | https://ca.slack-edge.com/T0EXAMPLE1-U0EXAMPLE1-…-512 | url
control: filename | text | robin-original.jpg | saved as
---

Fetch a URL and save it to the download folder. The renderer cannot do this for Slack's CDN, which serves without CORS headers.

```js
// The loader fetches it: Slack's CDN serves without CORS headers.
const { path } = await api.files.save(avatarUrl, 'robin-original.jpg');
```

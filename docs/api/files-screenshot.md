---
name: screenshot
group: files
title: api.files
signature: (options?: { size?: string; filename?: string }): Promise<{ path: string; bytes: number }>
since: 2.0.1
preview: files-screenshot
control: filename | text | slack-1440x900.webp | saved as
control: size | select | 1440x900 | size | 1440x900, 1280x800, 880x560
---

Photograph the Slack window and put the picture in the download folder.

A page cannot photograph itself, so the loader does it over CDP. `size`
is "<width>x<height>" and forces the viewport first, which is the only
way to get a frame that needs no cropping afterwards -- cropping takes
from the middle, and the top bar and the composer go missing. Defaults
to 1600x1000, the size every mod's picture in the catalogue uses.

Anything of your own that should not be in the picture has to be hidden
before you call this and put back after: the shutter is on the loader's
side, and it photographs whatever is on screen.

```js
const { path } = await api.files.screenshot({
  size: '1600x1000',
  filename: 'slack.webp',
});
```

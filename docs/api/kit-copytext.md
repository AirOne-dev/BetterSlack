---
name: copyText
group: kit
title: Component kit
signature: (text: string): Promise<boolean>
preview: kit-copytext
control: text | text | #611f69
---

Put text on the clipboard, and say whether it worked -- the clipboard can refuse.

```js
const ok = await kit.copyText(theme.css);
status.textContent = ok ? 'Copied' : 'Press ⌘C';
```

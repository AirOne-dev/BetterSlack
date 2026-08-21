---
name: emptyState
group: kit
title: Component kit
signature: (title: string, body: string, action?: HTMLElement): HTMLElement
since: 2.0.1
preview: kit-emptystate
control: title | text | No themes yet
control: body | text | Build one and it appears here.
control: action | text | New theme | button
---

What to draw when there is nothing to draw: a title, a sentence, and the one button that fixes it.

```js
kit.emptyState(
  'No themes yet',
  'Build one and it appears here.',
  kit.button('New theme', { variant: 'primary', onClick: () => create() }),
);
```

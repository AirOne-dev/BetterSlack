---
name: button
group: kit
title: Component kit
signature: (label: string, options?: ButtonOptions): HTMLButtonElement
since: 2.0.1
preview: kit-button
control: label | text | Save
control: variant | select | primary |  | default, primary, ghost, danger
control: wide | boolean | false
control: title | text | Write the theme to disk | tooltip
---

Slack's button in its four weights: the default, primary for the one action that matters, ghost for the quiet one, and danger for the one that destroys something.

```js
kit.button('Save', { variant: 'primary', onClick: () => save() });
kit.button('Remove', { variant: 'danger', wide: true });
```

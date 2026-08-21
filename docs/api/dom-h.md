---
name: h
group: dom
title: api.dom
signature: : typeof h
since: 2.0.1
preview: dom-h
control: tag | select | button |  | div, button, span
control: className | text | c-button c-button--primary | class
control: text | text | Made with api.dom.h
---

Build an element: a tag, its attributes, its children. Strings become text nodes.

```js
const row = api.dom.h('div', { class: 'my-row' }, [
  api.dom.h('strong', {}, [user.real_name]),
  '  ',
  api.dom.h('span', { class: 'my-hint' }, [user.tz_label]),
]);
```

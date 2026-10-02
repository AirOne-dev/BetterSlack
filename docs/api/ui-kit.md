---
name: kit
group: ui
title: api.ui
signature: (doc?: Document): Kit
since: 2.0.1
preview: ui-kit
---

Slack's design system, as components, bound to a document.

Inside the client, borrow Slack's own classes. A window a mod opens is a blank document with no stylesheet; the kit gives it the same look. Bind it to the document you mean and put `api.ui.kitCss` in that document's head. Every class it writes is prefixed `sm-`, so the stylesheet is also safe to inject into the client itself.

```js
// A window a mod opens is a blank document: no Slack stylesheet to borrow.
const kit = api.ui.kit(child.document);
child.document.head.append(
  Object.assign(child.document.createElement('style'), { textContent: api.ui.kitCss }),
);

kit.card('Palette', [kit.button('Save', { variant: 'primary', onClick: () => save() })]);
```

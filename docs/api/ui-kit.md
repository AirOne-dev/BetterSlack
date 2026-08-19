---
name: kit
group: ui
title: api.ui
signature: (doc?: Document): Kit
preview: ui-kit
---

Slack's design system, as components, bound to a document.

Inside the client, Slack's own classes are the right answer -- the Mods
panel wears `.c-dialog` and follows every theme for free. They are not
available anywhere else: a mod that opens a window of its own gets a
blank document with no stylesheet in it. This is that gap filled once,
rather than once per mod.

Bind it to the document you mean and put `api.ui.kitCss` in that document's
head; every class it writes is prefixed `sm-`, so the stylesheet is also safe
to inject into the client itself.

```js
// A window a mod opens is a blank document: no Slack stylesheet to borrow.
const kit = api.ui.kit(child.document);
child.document.head.append(
  Object.assign(child.document.createElement('style'), { textContent: api.ui.kitCss }),
);

kit.card('Palette', [kit.button('Save', { variant: 'primary', onClick: () => save() })]);
```

---
name: disclosure
group: helpers
title: api.helpers
signature: (options: DisclosureOptions): DisclosureHandle
since: 3.2.0
preview: helpers-disclosure
control: label | text | (edited)
control: motion | boolean | true | animated by Motion
---

Make something Slack already draws open and close — an "(edited)" label, a member count — so a mod with more to say puts it behind the label a reader would click rather than adding another toolbar button.

You get a caret, a keyboard control and a wrapper, and the component handles what makes this hard:

- **Slack replaces the element.** React rebuilds the subtree, so a listener bound to the node works once. The click is delegated from the document and matched by selector, and nothing is stored on the element.
- **Slack removes what was opened** in the same re-render, so the panel is put back.
- **Which one is open survives both**, because identity is the key `keyFor` derives from what the element is about, never the node.
- **Nothing is driven from an observer on the message list.** Slack re-renders it constantly, and putting nodes back from an observer there can freeze the renderer. Call `refresh()` from your own sweep.

`keyFor` returning null leaves that trigger exactly as Slack drew it. `refresh()` leaves a panel that is still on screen alone; `rebuild()` builds the content of every open panel again, for when what it shows has changed.

Nothing here animates. The classes `betterslack-disclosure`, `betterslack-disclosure__panel` and `betterslack-disclosure__inner` are stable so a mod such as Motion can. Closing is a state: the panel wears a closing class and is removed once whatever animation or transition the stylesheet put on it has finished, or at once when there is none. No height is measured — the panel unfolds as `grid-template-rows` going from `0fr` to `1fr`, so a long panel takes as long as a short one.

`refresh()` removes any panel this instance does not own, such as one left by an earlier start of the same mod, and disposing removes every panel in the document.

```js
const wordings = api.helpers.disclosure({
  trigger: '.c-message__edited_label',
  label: 'See what this said before',
  keyFor: (label) => {
    const message = label.closest(api.slack.selectors.message);
    const id = message?.getAttribute('data-msg-channel-id');
    const ts = message?.getAttribute('data-msg-ts');
    return id && ts && versionsOf(id, ts).length > 1 ? `${id}:${ts}` : null;
  },
  // Under the message, not under the word in the middle of it.
  anchor: (label) => label.closest(api.slack.selectors.message)
    ?.querySelector('[data-qa="message-text"]'),
  content: (label, key) => renderVersions(key),
});

api.helpers.poll(() => wordings.refresh(), 1500);
```

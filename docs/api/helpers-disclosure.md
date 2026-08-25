---
name: disclosure
group: helpers
title: api.helpers
signature: (options: DisclosureOptions): DisclosureHandle
since: unreleased
preview: helpers-disclosure
control: label | text | (edited)
control: motion | boolean | true | animated by Motion
---

Make something Slack already draws open and close. It marks an edited message with "(edited)" and a channel with a member count: exactly where a reader would ask for more, and neither answers. A mod with the answer makes that label the way in rather than adding a fifth button to a toolbar of four.

You get a caret, a keyboard control and a wrapper. What you avoid is the four things that make it hard, every one of which has been got wrong here first:

- **Slack replaces the element.** A listener bound to the node works exactly once — putting anything into a message makes React rebuild that subtree, so the second click lands on a different node. It reads as intermittent rather than broken. The click is delegated from the document and matched by selector, and nothing is ever remembered *on* the element.
- **Slack tears out what you opened**, by the same re-render, so it is put back rather than left to vanish under whoever opened it.
- **Which one is open has to survive both**, so identity is a key you derive from what the element is about, never the node.
- **None of it may be driven from an observer.** The message list is what Slack re-renders most, and an observer that reacts to that by putting a node back into it is the shape that has frozen this renderer twice. You call `refresh()` from your own sweep.

`keyFor` returning null is how a trigger says it has nothing to show, and that trigger is left exactly as Slack drew it. `rebuild()` builds the content of every open panel again, for when what it shows has changed under somebody looking at it — `refresh()` deliberately leaves a panel that is still on screen alone, since rebuilding one on every sweep would restart its animation.

**Nothing here animates.** The classes are stable so that Motion can: installing a mod called Motion is the statement of intent about animation, and a component that moves whether or not you asked takes that decision away.

Closing is a *state* rather than a removal — removing the panel outright leaves nothing on screen to animate — so it is marked with a closing class, and then taken away once whatever the stylesheet put on it has finished. How long that is comes from the panel itself: with nothing animating it, the answer is zero and it goes in the same breath, so a client without Motion never waits for something that is not happening. No height is measured anywhere, and that is deliberate: rows going between `0fr` and `1fr` interpolate over the animation's own time, so a long panel folds away in exactly as long as a short one. Measuring the content is what would make it vary.

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

# Discord Light

Discord Dark's stylesheet with Discord's light palette. Not a second theme that
resembles it: the same file, from the first rule onward, with one block of
colour changed — and a test that fails if the two ever drift.

- The whole of Discord Dark: round rail icons with the white pill that grows
  from a dot to a bar, Discord's sidebar and its 32px rows, the embed bar down
  the left of an unfurl, blurple mention chips, Discord's scrollbars.
- White conversation on grey chrome, blurple accent, circular avatars.
- The gg sans type stack, with fallbacks, so it looks right whether or not the
  font is installed.
- Brings in the member column and the account strip, which are the two parts of
  Discord that CSS cannot do. The panel asks before switching either on.

The colours are Discord's own published light-theme design tokens, named in the
stylesheet next to the values. Discord Dark's were sampled off a screenshot of
the real client instead — the two are honest about being different sources.

Two are neither: Discord paints a mention chip as blurple at 10% over whatever
is behind it. That works there and not here, because Slack puts a mention on the
pane, on a hovered row and inside a raised card, and a translucent chip is a
different colour in each. It is flattened to the value it resolves to on the
pane, with the text darkened enough to stay readable on it.

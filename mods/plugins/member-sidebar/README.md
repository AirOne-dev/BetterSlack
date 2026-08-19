# Member Sidebar

A column of the current channel's members down the right of the message pane, split into online and offline, where clicking someone opens their Slack profile.

- A column of the current channel’s members down the right of the conversation, online first.
- Drag its edge to resize it, exactly as you resize the channel list: the handle is Slack's own `.p-resizer`, so it has the same 8px grab area, the same cursor and the same look under every theme. The width is remembered.
- The list you saw last time is drawn before either request lands, and corrected behind you only if it changed — 81ms instead of 805ms, measured.
- Presence follows the client rather than polling: the dot changes when Slack’s own does.
- Whoever has set a status shows its emoji on their row, with the sentence in the tooltip — a custom workspace emoji included, drawn as the image the workspace has for it.
- Clicking someone opens their Slack profile, with the whole status and when it clears. Large channels are capped — the limits are in the settings.
- Discord Dark asks for this one, and it also stands alone: it reads Slack’s design tokens, so it follows whatever theme you are on.

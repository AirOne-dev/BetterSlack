# DevTools

Opens and closes Slack's real Chrome DevTools — console, elements, network, the lot — from a button above the BetterSlack one. Same action as Slack's own hidden ⌘⌥I menu item.

- A button beside the BetterSlack one that opens Slack’s real Chrome DevTools — console, elements, network.
- It calls Slack’s own preload method, the one behind its hidden ⌘⌥I menu item, so nothing is patched or injected to make it work.
- Slack only acts on a focused window, so the button does nothing while Slack is in the background.

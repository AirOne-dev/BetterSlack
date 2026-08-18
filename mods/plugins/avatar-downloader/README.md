# Avatar Downloader

Download a member's profile picture at the highest quality Slack stores — the original upload when there is one, otherwise the largest rendition. Adds a button to the profile pane and to the hover actions on a message.

- A Download picture button in the profile pane, and the same action in the hover actions on any message.
- It asks Slack for the original upload first and falls back to the largest rendition, so you get the best file that exists rather than the 48px one on screen.
- The download goes through the loader: Slack’s CDN sends no CORS headers, so the page itself cannot fetch it.

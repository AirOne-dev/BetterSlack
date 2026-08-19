# Demo Mode

Puts a switch in the top bar that fills your real Slack with people who do not exist: every name, face, message, channel, file and link on screen is replaced by an invented one, so you can screenshot, screen-share or demo your own client without showing anybody's work. Press it again and the real thing comes back. It starts off, and stays off until you ask.

- **The switch is at the right-hand end of the top bar**, beside Slack's own controls, and it turns red while the demo is running. Installing the mod is not the request; pressing the switch is.
- **The state is deliberately not remembered.** Every start is off. Coming back to a Slack full of invented names after a restart, and reading them as real, is the one failure this mod could cause on its own.
- It **replaces** rather than blurs. A blurred name is still a name that was on the screen, and a black box says the picture had something to hide; substitution gives a screen that looks like Slack in use and contains nobody.
- Every replacement is derived from a hash of the original, so the same person is the same invented person in the sidebar, in the messages and in the member list — and two runs produce the same screen.
- **A red strip stays across the bottom the whole time.** Forgetting which state you are in is the actual risk: a screenshot you thought was anonymous, or a name you thought was invented.
- Switching it off puts everything back, and only where Slack has not re-rendered since — writing a stale message back over a newer one would be its own kind of wrong.
- "Check the screen", from the command palette, lists anything real still showing. It is an absolute rule rather than a memory: after a sweep, nothing drawn may point anywhere but at example.com.
- The composer is swept once, when demo mode starts, and then left alone. Rewriting it on every keystroke would make the client unusable; what you type during a demo is your own words, on your own screen.
- Code blocks become code, not prose, so a screenshot of a syntax highlighter still shows syntax.
- This is the same engine `pnpm shoot --mods` runs before it photographs a real workspace, so the pictures in this repository and the ones you take yourself hide the same things.

What it cannot do is make a leak impossible: the sweep is a list of the places Slack puts content, and a list can always miss one. That is what "Check the screen" is for — read it before you press the shutter.

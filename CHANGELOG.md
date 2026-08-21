# Changelog

Written for the people upgrading. `pnpm release` seeds each section from the
commits since the last tag; the release then rewrites it into something worth
reading.

## 2.1.0 — 2026-08-19

### Added

- **themes:** settings, without a theme running any code
- **member-sidebar:** drag its edge, with Slack's own handle
- draw the list you saw last time, and confirm it behind you
- **palette:** say it is still looking, instead of that nothing matches
- the mark you drew, everywhere the old one was
- **build-app:** install into /Applications, asking for root only if refused
- **palette:** people carry their status, and a menu draws above its dialog
- **panel:** say which mod folders were skipped, and let the list be sorted
- **sidebar-account:** the status emoji opens Slack's own status dialog
- **slack:** statuses, emoji and all, in both mods that show people
- drop Focus Mode, rebuild Discord Light on Discord Dark

### Fixed

- read the workspace the client is showing, not the one the URL names
- an attribute filter that left out the one attribute that changes
- **member-sidebar:** drop an answer that arrived after the workspace moved
- **runtime:** our stylesheets before the plugins, and statuses that update
- **sidebar-account:** the status emoji was being drawn as your face
- **site:** the doc list is a drawer on a phone, not a 220px window
- **site:** the knobs are a list, not a boxed grid
- **site:** the tab says Doc, and five code blocks were never coloured
- **panel:** the update notice was a stripe, and updating looked broken

### Documentation

- **api:** currentTeamId, and why it is not a regex over the URL
- **api:** audit all 96 entries, and date every page
- describe the current state, and say which Applications folder
- a guide on the doc page, and answers to two fair questions

### Other

- **catalog:** the reason a mod was refused has to reach the person

## 2.0.1 — 2026-08-19

### Added

- update CLAUDE.md, pnpm-workspace.yaml, and .nvmrc
- **site:** the API reference is one page, one panel at a time, and it renders Slack's own widgets
- **site:** the API page is a playground, and the navbar is three things
- **site:** an API reference generated from the API, with the kit running on the page
- **demo-mode:** a camera beside the switch
- **demo-mode:** a switch in the top bar, off until you press it
- **demo-mode:** a Slack full of people who do not exist
- **site:** the catalogue shows every mod, not only the themes
- **panel:** every mod has a page
- **shots:** one picture per mod, taken in a real Slack and emptied of it
- **catalogue:** a mod can describe itself properly

### Fixed

- **ci:** both jobs were broken by something other than the code
- **site:** the API list would not scroll, and the demos read like a component library now
- **site:** the page was laid out 569px wide on a 390px screen
- **build-app:** the app cannot live in the folder it is not allowed to read
- **build-app:** compile the launcher, so macOS treats it as an application
- **build-app:** the guard that explains a failure was why nothing was explained
- **build-app:** say why the launcher cannot read its own repository

### Changed

- **api:** the markdown is the source, and the page is built from it
- **shots:** WebP everywhere, and Chromium is the encoder

### Documentation

- audit every claim against the code it describes
- **api:** finish the folder — real descriptions, the tools back, and 67 previews
- the screenshot pipeline, the mod page, and what the audit found

### Other

- Fix site & documentation
- one command before pushing, and three package.json entries that were noise
- delete what nothing could reach, and give seven mods a second frame


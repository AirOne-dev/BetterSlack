---
name: Install and run
title: Getting started
order: 1
---

BetterSlack drives the Slack desktop app over the Chrome DevTools Protocol and
injects a runtime into it. It never modifies `Slack.app`, so a Slack update
cannot break your install.

## What you need

Node **20.19+, 22.13+ or 24+**, and pnpm. It has to be pnpm: esbuild fetches its
platform binary in an install script, and `pnpm-workspace.yaml` is what allows
that script to run. `corepack enable` is enough to get it — that wants Node 22+,
since pnpm 11 refuses to run on anything older when Node is what runs it.

## Run it

```bash
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
nvm use
pnpm install && pnpm build
pnpm start
```

`nvm use` is optional and only does anything if you use nvm — there is a
`.nvmrc` in the repository pinning the version CI runs, so it saves you finding
out from an error message which Node this wants.

`pnpm build` is **not** optional, which is worth saying because the other two
are obvious and this one is not. The loader and the runtime are TypeScript,
`dist/` is not committed, and `bin/betterslack.mjs` refuses to start without
`dist/loader.mjs`. You need it once after cloning and again after any change
under `src/`. You never need it for a change under `mods/`: the loader watches
that folder and broadcasts what changed into the running client, with no
restart at all.

`pnpm start` restarts Slack with BetterSlack attached and stays running. Mods
are active as long as it does, so leave that terminal open — it is also where
the page's own errors are printed, which is how a mod that threw at boot tells
you so.

Nothing is installed on a fresh setup. The repository is a catalogue, not a set
of pre-installed mods: open the panel with **⌘⇧M** and install what you want
from **Browse**.

## On macOS, without a terminal

```bash
pnpm build-app --install
```

That puts a **BetterSlack.app** in `~/Applications`, so it starts from
Spotlight, the Dock or your login items. It is a launcher rather than a bundle —
it runs this checkout, so keep the project folder where it is.

Two things it needs. A C compiler at build time (`xcode-select --install`),
because the bundle's executable has to be a real binary: macOS gates Desktop,
Documents and Downloads per application, and an app whose executable is a shell
script is not an application as far as that gate is concerned — the process it
sees is `/bin/bash`. And, if the project lives in one of those three folders,
macOS asks once for permission to read it. Say yes.

Do not run the copy left in `dist/`. An app inside a gated folder cannot read
even its own launcher, and a double-click does nothing at all.

## If something goes wrong

```bash
pnpm start --safe
```

That applies nothing. So does the next start after a run that never reported
itself healthy — a mod that wedges the renderer cannot lock you out. A mod that
throws on start is named on its own row, and is skipped after two failures until
you switch it off and on again.

```bash
pnpm test:live
```

Boots the real Slack, asks the runtime what actually loaded, and turns the
answer into an exit code. It closes Slack afterwards.

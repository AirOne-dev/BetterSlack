---
name: Install and run
title: Getting started
order: 1
---

BetterSlack drives the Slack desktop app over the Chrome DevTools Protocol and
injects a runtime into it. It never modifies `Slack.app`, so a Slack update
cannot break your install.

## Install it

```bash
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
./install.sh
```

On Windows, in PowerShell:

```powershell
git clone https://github.com/AirOne-dev/BetterSlack.git
cd BetterSlack
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

That is all of it. There is no step before this one: nothing needs to be
installed first, not Node and not pnpm.

## What it actually does

Worth knowing, because an installer that will not say is an installer you have
to take on trust.

It finds a Node that satisfies this project's `engines` — and finds it by
version, not by taking the first `node` on your `PATH`, which on a machine with
nvm is whatever its `default` alias points at and is frequently too old. If
there is no usable one it downloads the current LTS from nodejs.org into
`~/.betterslack/runtime`, checks it against the digest published beside it, and
keeps it to itself: nothing is added to your `PATH` and no other project sees
it.

Then it gets pnpm from Corepack, which ships inside Node, at the exact version
`package.json` pins. It has to be pnpm — esbuild fetches its platform binary in
an install script, and `pnpm-workspace.yaml` is what allows that script to run.

Then it builds, and copies the result into `~/.betterslack/app`: the two
bundles, the entry point and the mod catalogue, about 6 MB. A Node it had to
download sits beside it in `~/.betterslack/runtime` and is a further ~190 MB.

Finally it makes something you can double-click — `BetterSlack.app` in
`/Applications` on macOS, a `.desktop` entry and a `betterslack` command on
Linux, a Start menu shortcut on Windows.

Everything is written under your home directory, with one exception the
installer announces before it happens: copying the app into `/Applications` on
macOS. That folder is owned by root and writable by the `admin` group, so on a
Mac whose owner is an administrator — most of them — it needs no password at
all. Where it does, macOS asks, and the terminal has already said what for.

**The clone is not part of the install and can be deleted.** Nothing in
`~/.betterslack/app` refers back to it. Keep it only if you intend to work on
BetterSlack itself.

## Run it

Start BetterSlack the way you start any application: Spotlight, the Dock, your
login items, the Start menu, your desktop's applications menu.

It restarts Slack with BetterSlack attached and keeps running for as long as
Slack does. Nothing is enabled on a fresh install — the repository is a
catalogue, not a set of pre-installed mods. Open the panel with **⌘⇧M** and
install what you want from **Browse**.

## Update, and uninstall

Run the installer again. It rebuilds from the clone you have, so `git pull`
first if you want the newest version. BetterSlack can also update itself from
the panel, which fetches the current source, builds it and re-stages the
install without touching anything else.

To uninstall, delete `~/.betterslack` and the launcher: the app in
`/Applications`, or `~/.local/bin/betterslack` and
`~/.local/share/applications/betterslack.desktop`, or the Start menu shortcut.

## If something goes wrong

**Look at the log first.** It is at `~/Library/Logs/BetterSlack.log` on macOS
and `~/.betterslack/betterslack.log` on Linux and Windows, and it holds the
page's own errors as well as the loader's — which is how a mod that threw at
boot tells you so.

Nothing is applied after a run that never reported itself healthy, so a mod that
wedges the renderer cannot lock you out. A mod that throws on start is named on
its own row in the panel, and is skipped after two failures until you switch it
off and on again.

To start with everything off deliberately:

```bash
# Linux
betterslack --safe

# macOS: the app takes no flags, so run the loader with the Node the installer
# recorded when it staged the install
"$(cat ~/.betterslack/app/node-path)" ~/.betterslack/app/bin/betterslack.mjs --safe
```

On macOS, two things are worth knowing. The first launch needs right-click →
**Open**, because the app is unsigned. And if you had no C compiler when you
ran the installer, the app is a shell script rather than a real binary: it
launches, but macOS refuses it access to `~/Downloads`, which is where a mod
saves a file. `xcode-select --install`, then run the installer again.

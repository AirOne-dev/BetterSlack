# Getting started

Three tracks. Pick the one you need — each is one page, and the same page the
site publishes under **[Doc](https://airone-dev.github.io/BetterSlack/api.html)**.

| | |
| --- | --- |
| **[Install and run](guide/install.md)** | You want BetterSlack on your Slack. What the installer does, how to update it, and what each symptom means when something is wrong. |
| **[Your first plugin](guide/plugin.md)** | You want Slack to *do* something new. A working mod from nothing, then settings, languages, the helpers, more than one file, the page a reader sees, tests and shipping. |
| **[Your first theme](guide/theme.md)** | You want Slack to look different. The four token families, the backdrop, colours somebody else can change, and when a look needs a plugin. |

## The rest of the documentation

| | |
| --- | --- |
| [docs/api.md](api.md) | The plugin API, with an example per entry |
| [docs/themes.md](themes.md) | Slack's colour tokens, the traps, recipes |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Review rules and the pull request checklist |
| [README.md](../README.md) | What BetterSlack is and how it works |
| [CLAUDE.md](../CLAUDE.md) | Notes for an agent working in this repository |

## The commands, in one place

A user never runs any of these: installing BetterSlack is `./install.sh` and
nothing else. These are for working on it, from a checkout.

```bash
pnpm install && pnpm build     # once, and again after any change under src/
pnpm start                     # launch Slack with mods, from this checkout
pnpm new-mod plugin my-plugin "What a user gets"

pnpm check                     # the whole gate, in one command
pnpm test -- <id>              # one mod's tests
pnpm check-structure -- <id>   # is it loadable
pnpm test:live                 # boot the real Slack and grade what loaded
```

Mods hot-reload: anything under `mods/` is live in the running client as you
save it, with no build and no restart. Only a change under `src/` needs
`pnpm build`, and `pnpm dev` rebuilds on change.

Mods in `~/.betterslack/mods/` shadow the repository's copies, which is how you
iterate on something already merged.

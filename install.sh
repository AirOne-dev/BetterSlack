#!/bin/sh
#
# Install BetterSlack on macOS or Linux.
#
#   git clone https://github.com/AirOne-dev/BetterSlack.git
#   cd BetterSlack && ./install.sh
#
# git is not one of the things this needs -- it is only one way to get the
# folder here. A ZIP from GitHub, or curl piped into tar, lands the same tree,
# and an install updates itself from the branch tarball rather than by pulling.
#
# It asks nothing of the machine beyond a shell, curl and tar. Node and pnpm are
# found if they are there and fetched into ~/.betterslack/runtime if they are
# not, so "install Node first" is never an instruction anybody has to follow.
# Nothing is installed system-wide and nothing needs a password, with one
# exception noted where it happens: copying the app into /Applications on macOS,
# and only if an ordinary copy is refused first.
#
# POSIX sh, not bash. The Linux images people actually run this on -- Debian
# slim, Alpine -- have /bin/sh as dash or busybox, and a bashism here fails on
# the machine least able to explain why.

set -eu

REPO="$(cd "$(dirname "$0")" && pwd)"
BS_HOME="${BETTERSLACK_HOME:-$HOME/.betterslack}"
RUNTIME="$BS_HOME/runtime"

# The LTS line to fetch when the machine has no usable Node. It only has to
# satisfy package.json's engines -- which scripts/node-ok.cjs checks against the
# downloaded copy too, so a wrong guess here fails loudly rather than installing
# something that cannot run the loader.
NODE_LINE="22.x"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) OS=macos ;;
  Linux)  OS=linux ;;
  *) die "install.sh covers macOS and Linux. On Windows, run install.ps1 in PowerShell." ;;
esac

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is needed and was not found."; }
need curl
need tar

# ---------------------------------------------------------------------------
# A Node that can actually run this
# ---------------------------------------------------------------------------
#
# Chosen by version, never by position on PATH. Sourcing nvm puts its `default`
# alias in front of everything, and that alias is whatever the user last pointed
# it at -- Node 14 on the machine this was written on, which cannot parse the
# loader at all. scripts/node-ok.cjs is the judge, and it reads the range out of
# package.json so this script has no version math in it.

NODE=""
PNPM=""
PNPM_KIND=""
PNPM_VERSION=""

# node-ok.cjs prints a sortable version key for a Node it accepts, and nothing
# at all for one it does not.
rank() {
  [ -n "${1:-}" ] && [ -x "$1" ] || return 0
  key="$("$1" "$REPO/scripts/node-ok.cjs" 2>/dev/null)" || return 0
  [ -n "$key" ] || return 0
  printf '%s %s\n' "$key" "$1"
}

# What the user's own shell would run comes first: if it can build this, it is
# the one they meant. Everything else follows, newest qualifying copy first.
# It has to be a *list* rather than a single winner, because satisfying engines
# is not the whole of the question -- see pnpm_ok below.
CANDIDATES="$(
  rank "$(command -v node 2>/dev/null || true)"
  for candidate in \
    "$RUNTIME"/node/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node \
    "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node \
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node
  do
    rank "$candidate"
  done | sort -rn
)"
# The shell's own node is usually one of the copies found below it as well.
CANDIDATES="$(printf '%s\n' "$CANDIDATES" | awk 'NF && !seen[$0]++')"

# ---------------------------------------------------------------------------
# ...and that can run the pnpm this project pins
# ---------------------------------------------------------------------------
#
# packageManager names one exact pnpm, and that pnpm has a Node floor of its
# own which is higher than the app's: pnpm 11 requires node:sqlite, which
# arrived in Node 22.5, while engines.node still admits 20.19 because that is
# all the loader and the tests need. "Satisfies engines" therefore does not mean
# "can build this checkout", and the gap is not theoretical: measured on a Mac
# whose shell node was 20.20.2, where this script announced that Node as usable
# and the install then died with ERR_UNKNOWN_BUILTIN_MODULE out of pnpm's own
# bundle -- with fourteen newer Nodes sitting unused under ~/.nvm.
#
# The check is to run pnpm rather than to write its floor down here. A second
# version number in the repository is one nobody bumps when packageManager
# moves, and the release where they forget is the release that needed it.
#
# It has to be pnpm at all because esbuild fetches its platform binary in an
# install script, and only pnpm-workspace.yaml says which install scripts may
# run. Corepack ships inside Node, so asking it for the pinned pnpm needs
# nothing installed -- and this first call is also what downloads it, before
# anything that matters depends on it being there.
#
# COREPACK_ENABLE_DOWNLOAD_PROMPT=0 because this may be running unattended, and
# a prompt nobody answers looks exactly like a hang.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

pnpm_ok() {
  bin="$(dirname "$1")"
  if [ -x "$bin/corepack" ]; then
    kind=corepack; cmd="$bin/corepack pnpm"
  elif command -v corepack >/dev/null 2>&1; then
    kind=corepack; cmd="corepack pnpm"
  elif command -v pnpm >/dev/null 2>&1; then
    kind=own; cmd="pnpm"
  else
    return 1
  fi
  version="$(PATH="$bin:$PATH" $cmd --version 2>/dev/null)" || return 1
  [ -n "$version" ] || return 1
  PNPM="$cmd"
  PNPM_KIND="$kind"
  PNPM_VERSION="$version"
}

# Positional parameters rather than a loop over an unquoted expansion: the
# splitting has to be on newlines, since a home directory may contain a space,
# and IFS cannot stay that way while the loop is running commands of its own.
saved_ifs="$IFS"
IFS='
'
set -- $CANDIDATES
IFS="$saved_ifs"

for entry in "$@"; do
  candidate="${entry#* }"
  if pnpm_ok "$candidate"; then NODE="$candidate"; break; fi
  warn "Node $("$candidate" -v) satisfies this project's engines but cannot run its pnpm; looking for one that can."
done

# ---------------------------------------------------------------------------
# ...or one fetched, checksummed, and kept to ourselves
# ---------------------------------------------------------------------------
#
# nodejs.org publishes SHASUMS256.txt per release line, which names the exact
# file and its digest in one fetch -- so the version need not be pinned here and
# go stale, and no JSON parser is needed on a machine that has no Node yet.
# The download is verified before it is unpacked: an installer that pipes an
# unverified archive into tar is one bad mirror away from being the problem.

download_node() {
  case "$OS-$(uname -m)" in
    macos-arm64)          slug=darwin-arm64 ;;
    macos-x86_64)         slug=darwin-x64 ;;
    linux-x86_64)         slug=linux-x64 ;;
    linux-aarch64|linux-arm64) slug=linux-arm64 ;;
    *) die "no official Node build for $(uname -s) $(uname -m). Install Node yourself, then run this again." ;;
  esac

  base="https://nodejs.org/download/release/latest-v$NODE_LINE"
  if [ -n "$CANDIDATES" ]; then
    say "No Node on this machine can build BetterSlack. Fetching the current $NODE_LINE LTS build for $slug..."
  else
    say "No usable Node found. Fetching the current $NODE_LINE LTS build for $slug..."
  fi

  sums="$(curl -fsSL --retry 3 "$base/SHASUMS256.txt")" \
    || die "could not reach nodejs.org to download Node."
  line="$(printf '%s\n' "$sums" | grep -- "-$slug\.tar\.gz\$" | head -1)"
  [ -n "$line" ] || die "nodejs.org listed no $slug build for the $NODE_LINE line."
  file="${line##* }"
  sum="${line%% *}"

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT INT TERM
  curl -fsSL --retry 3 -o "$tmp/$file" "$base/$file" || die "could not download $file."

  # shasum on macOS, sha256sum on Linux; whichever is here.
  if command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)"
  elif command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$file" | cut -d' ' -f1)"
  else
    die "neither shasum nor sha256sum is available to verify the download."
  fi
  [ "$actual" = "$sum" ] || die "the Node download did not match its published checksum."

  rm -rf "$RUNTIME/node"
  mkdir -p "$RUNTIME/node"
  tar -xzf "$tmp/$file" -C "$RUNTIME/node" --strip-components=1
  rm -rf "$tmp"
  trap - EXIT INT TERM

  NODE="$RUNTIME/node/bin/node"
  [ -x "$NODE" ] || die "the Node archive unpacked without a usable binary."
  "$NODE" "$REPO/scripts/node-ok.cjs" >/dev/null \
    || die "the Node that was downloaded does not satisfy this project's engines."
  pnpm_ok "$NODE" \
    || die "pnpm would not run even on a freshly downloaded Node. Corepack fetches it, so check the network."
}

[ -n "$NODE" ] || download_node

NODE_BIN="$(dirname "$NODE")"
PATH="$NODE_BIN:$PATH"
export PATH

say "Node: $("$NODE" -v) ($NODE)"
if [ "$PNPM_KIND" = corepack ]; then
  say "pnpm: $PNPM_VERSION (Corepack)"
else
  # Not the pinned version, so say so rather than letting a lockfile mismatch
  # surface later as an install error with no obvious cause.
  warn "Corepack is missing; using the pnpm already on this machine ($PNPM_VERSION) rather than the pinned one."
fi

say "Installing build dependencies..."
( cd "$REPO" && $PNPM install --frozen-lockfile ) || die "the dependency install failed."

say "Building..."
( cd "$REPO" && $PNPM run build ) || die "the build failed."

# ---------------------------------------------------------------------------
# The install itself
# ---------------------------------------------------------------------------
#
# scripts/stage-install.mjs decides what an install contains, for all three
# platforms, so this script does not have an opinion about it. It copies the
# bundles, the entry point and the mod catalogue into ~/.betterslack/app and
# records the Node chosen above -- about 6 MB, and independent of this checkout,
# which can be deleted afterwards.

say "Staging the install..."
"$NODE" "$REPO/scripts/stage-install.mjs" --home "$BS_HOME" --node "$NODE" >/dev/null \
  || die "staging the install failed."
APP="$BS_HOME/app"

if [ "$OS" = macos ]; then
  say "Building BetterSlack.app..."
  "$NODE" "$REPO/scripts/build-app.mjs" --install || die "building the macOS app failed."
else
  say "Installing the launcher..."
  "$NODE" "$REPO/scripts/build-desktop.mjs" --home "$BS_HOME" || die "installing the launcher failed."
fi

say "Done."
printf '\n'
printf '  BetterSlack is installed in %s\n' "$APP"
if [ "$OS" = macos ]; then
  printf '  Open it from Applications, or with: open -a BetterSlack\n'
  printf '  The first launch needs right-click -> Open, because the app is unsigned.\n'
else
  printf '  Launch it from your applications menu, or with: betterslack\n'
fi
printf '  Logs: %s\n' "$([ "$OS" = macos ] && echo "$HOME/Library/Logs/BetterSlack.log" || echo "$BS_HOME/betterslack.log")"
printf '\n'
printf '  This checkout is no longer needed and can be deleted.\n'
printf '  Keep it only to work on BetterSlack itself.\n'

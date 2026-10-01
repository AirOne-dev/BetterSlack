/*
 * Start Slack as its own app in macOS's eyes, not as BetterSlack's child.
 *
 * macOS decides who is asking for the microphone, the camera or the screen by
 * the *responsible* process, and a process inherits its parent's. Slack
 * launched by the loader is BetterSlack's child, so a huddle asked
 * dev.airone.betterslack for the microphone -- a bundle with none of Slack's
 * usage strings and none of the grants the user gave Slack -- and macOS killed
 * Slack on the spot. Disclaiming responsibility at spawn makes Slack answer
 * for itself again: its own Info.plist, its own grants, no new prompt.
 *
 *   disclaim <program> [args...]
 *
 * POSIX_SPAWN_SETEXEC replaces this process rather than creating a child, so
 * the loader's ChildProcess *is* Slack: same pid, same exit code, and fds 3
 * and 4 -- the --remote-debugging-pipe descriptors -- carried across as an
 * exec would.
 *
 * It is committed prebuilt (bin/darwin/disclaim) because an install must never
 * need a compiler; `pnpm build:disclaim` rebuilds it, and a test fails if this
 * file changes without that.
 *
 * Every failure falls through to a plain exec. Slack started the old way can
 * crash on a call; Slack not started at all is no Slack.
 */

#include <spawn.h>
#include <stdio.h>
#include <unistd.h>

extern char **environ;

/*
 * Private, in libSystem since 10.14, and what Chromium and LLDB use for the
 * same job. Weak, so a macOS that drops it still loads this binary -- the
 * symbol is simply NULL and the plain exec below takes over.
 */
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim)
  __attribute__((weak_import));

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: disclaim <program> [args...]\n");
    return 64;
  }

  if (responsibility_spawnattrs_setdisclaim) {
    posix_spawnattr_t attrs;
    if (posix_spawnattr_init(&attrs) == 0) {
      posix_spawnattr_setflags(&attrs, POSIX_SPAWN_SETEXEC);
      if (responsibility_spawnattrs_setdisclaim(&attrs, 1) == 0) {
        pid_t pid;
        // Only returns on failure: on success this process is now the program.
        int err = posix_spawn(&pid, argv[1], NULL, &attrs, argv + 1, environ);
        fprintf(stderr, "disclaim: spawn failed (%d), starting without it\n", err);
      }
      posix_spawnattr_destroy(&attrs);
    }
  }

  execv(argv[1], argv + 1);
  perror("disclaim: exec");
  return 127;
}

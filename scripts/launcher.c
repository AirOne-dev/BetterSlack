/*
 * The executable inside BetterSlack.app, and the reason there is one at all.
 *
 * A bundle whose executable is a shell script is not an application as far as
 * macOS's gate on Desktop, Documents and Downloads is concerned: the process it
 * sees is /bin/bash, a platform binary with no identity of its own, so the read
 * is refused with no prompt and nothing to grant. With a real Mach-O here, the
 * app has an identity, macOS asks, and everything below inherits the answer.
 *
 * All this does is find the shell script next door and hand over to it, so
 * every decision stays somewhere readable.
 */

#include <mach-o/dyld.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/*
 * Say something rather than nothing.
 *
 * If the app itself sits inside one of those protected folders it cannot read
 * its own launcher either, and then exec fails, main returns, and a
 * double-click does absolutely nothing at all -- which is exactly how this was
 * reported. Running another program is not gated, only reading a file is, so
 * osascript can still put the reason on screen.
 */
static void explain(void) {
  execl("/usr/bin/osascript", "osascript", "-e",
        "display alert \"BetterSlack\" message "
        "\"BetterSlack cannot read its own files, because it is inside a folder macOS "
        "protects: the Desktop, Documents or Downloads.\" & return & return & "
        "\"Move BetterSlack.app to your Applications folder and open it from there, "
        "or run install.sh again from the repository, which puts it there for you.\"",
        (char *)NULL);
}

int main(void) {
  char exe[4096];
  uint32_t size = sizeof(exe);
  if (_NSGetExecutablePath(exe, &size) != 0) return 1;

  char *slash = strrchr(exe, '/');
  if (slash) *slash = '\0';

  char script[4600];
  snprintf(script, sizeof(script), "%s/../Resources/launch.sh", exe);

  if (access(script, R_OK) != 0) {
    explain();
    return 1;
  }
  execl("/bin/bash", "bash", script, (char *)NULL);
  explain();
  return 1;
}

# Custom Sounds

Use your own sound files for Slack's notifications.

Open **Preferences → Notifications**. Every sound list there has, under Slack's own sounds:

- **your sounds**, the ones you added;
- **Add a sound…**, which opens a file picker (mp3, wav, ogg, m4a, flac…, up to 5 MB);
- **Manage your sounds…**, where you can play, rename or delete them.

It works for every list on that page: messages, VIP messages, sending a message, receiving one while you are in the conversation, huddles and calendar notifications. The manager is also in the command palette, as *Manage custom sounds*.

## Deleting a sound

Deleting asks you to confirm. Every list that was using the sound then goes back to the sound it had before you picked it. Nothing is left silent by accident: if the previous choice was no sound at all, it goes back to no sound.

## Where the files go

Your files are kept on this computer, in `~/.betterslack/data/custom-sounds/`. Nothing is uploaded, and Slack never sees the file.

## How it works

When Slack is about to play a sound, it only says which file it is playing, never what for. So each custom sound rides on one of Slack's own sounds, its *carrier*:

- The list's setting in Slack is set to the carrier.
- When Slack plays the carrier, your file plays instead, at the same volume and on the same output device.

Whenever it can, the carrier is the sound you had before. So:

- Slack on another computer, without BetterSlack, keeps playing your previous sound.
- Switching this plugin off brings that sound straight back.

On a Mac, Slack normally hands notification sounds to macOS, and macOS can only play the sounds that come with Slack. So while a notification uses one of your sounds, the plugin asks Slack to play notification sounds itself, which is Slack's own default. It does this at every start, because Slack switches it back each time it launches. When no notification uses a sound of yours any more, or when the plugin is switched off, the previous setting comes back.

Your choice is written through Slack's own list, the way you would make it yourself. That is why choosing happens in Preferences. If a sound you delete needs Slack's list to fall back and Preferences is closed, the fallback is applied the next time you open it.

Needs BetterSlack 3.4.0 or later: it keeps your files with `api.data`.

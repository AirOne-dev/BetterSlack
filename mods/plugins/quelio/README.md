# Quelio

A slim bar at the top of Slack showing how far your week is toward its Quelio objective, when to leave today, and where your lunch break stands.

- **The bar** sits in Slack's top bar, beside the search: a thin meter for the week, a thinner one for today, the week's total and one line about right now — *2h 08m to go · leave at 17:24*, *Lunch · 32 min of 1h · back at 13:17*, *Free to leave*. A narrow window shortens it on its own, down to the meter alone.
- **A click** opens the details: the week (done, objective, remaining), today (arrival, what Quelio counts so far, lunch, what is left, the suggested departure and the allowed window) and each day of the week.
- **It moves with the clock.** Quelio is asked about once an hour; how long lunch has lasted and what is left today are worked out locally from the last answer, so the bar is never an hour behind.

## Setting it up

1. Install and switch on Quelio from the Browse shelf.
2. Click **Quelio · Sign in** in the top bar. The first time, it asks for your company's **quelio-api address** — the server, ending in a slash, such as `https://example.com/quelio-api/`. It is kept in the plugin's settings, where you can change it.
3. Sign in with your Quelio username and password.

The settings also choose how often to refresh (an hour at least) and how much the bar shows: progress and today's status, progress and what is left, or progress only.

## How the suggestion is made

The weekly objective is Quelio's own (`minutes_objective`, or 38 hours if it gives none). What is left is shared **evenly** over the working days left in the week, except that no day can hold more than it can — a day runs at most from 08:30 to 18:30, Friday to 17:30, with an hour for lunch — and a day that cannot take its share hands the rest to the others. That share is today's objective. The suggested departure is when you reach it, and **never before 16:30** nor after the latest departure.

If the hours left cannot be done even by staying as late as allowed on every day left, it says so, with what is missing, and suggests staying until the latest departure — never a time that breaks a rule.

The rules every suggestion keeps to:

- **Arrival** between 08:30 and 09:00.
- **Lunch** starts between 12:00 and 13:00, ends by 14:00, and lasts an hour at least.
- **Departure** not before 16:30, and by 18:30 — 17:30 on Friday.

Lunch is read from your badges: the first break that overlaps 12:00–14:00. Quelio only credits the part of it inside that window, so a lunch started at 11:50 has its hour up at 13:00, not 12:50.

**Days off.** A day with no badges can be marked as a day off in the details. It counts for a fifth of the weekly objective and takes no hours. Half days are not supported.

## What it sends, and where

- **One kind of request, to one address**: a `POST` to the quelio-api address in the settings, with `action=login` and your Quelio username plus either your password (once, to sign in) or the token Quelio returned. Nothing from Slack — no message, channel, workspace or Slack token — is ever sent.
- The request is made by BetterSlack's loader through `api.net`, because quelio-api sends no CORS headers and a page in Slack cannot read its answer. The manifest names the address setting under `network`, and the loader refuses any other address, plain http, and redirects.
- Each refresh makes Quelio sign in to Kelio, which is why quelio-api asks for no more than one call an hour. A refused password is never retried behind your back: five failures in five minutes block your whole network for a while.

## What it keeps, and how

- **Your password is never stored.** It leaves the form the moment you press Sign in, and is sent once.
- **The session token and this week's hours are kept in the plugin's own data folder** (`~/.betterslack/data/quelio/`, through `api.data`), so a restart does not ask you to sign in again. They are deliberately not in BetterSlack's settings file, which is copied into every BetterSlack backup and into the script every Slack page starts with. They are still plain files on disk: **they are not encrypted**, and anyone who can read them can use the token to read your hours through quelio-api until the token is invalidated there.
- Your username, for the sign-in form, and the days you marked off are in the settings file with the plugin's other settings.
- **Sign out** forgets the token, the hours and the username on this computer. Removing the plugin does not: BetterSlack keeps a plugin's data folder when the plugin goes, so sign out first. quelio-api has no way to revoke a token remotely, so it stays valid on the server until Quelio invalidates it, which a failed Kelio sign-in or a password change does.
- When Quelio says the session is over, the plugin signs out and asks you to sign in again; it never retries with a token it knows is dead.

## Limits

- The rules above are fixed, in `lib/rules.js`, and so is Quelio's way of counting (the defaults of quelio-api's `config.example.php`). If your server counts differently, today's figure still follows Quelio's answer; only the progress since that answer is computed locally.
- It reads the time from your computer's clock, which is the badge reader's for anyone in the same time zone.
- Between two refreshes, a badge you have just made is not known yet. The details say when the hours were last read, and **Refresh** asks again — at most every five minutes.

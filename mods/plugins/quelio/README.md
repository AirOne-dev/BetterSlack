# Quelio

A slim bar at the top of Slack showing how far your week is toward its Quelio objective, when to leave today, and where your lunch break stands.

- **The bar** sits in Slack's top bar, beside the search: a thin meter for the week, a thinner one for today, the week's total and one line about right now — *2h 08m to go · leave at 17:24*, *Lunch · 32 min of 1h · back at 13:17*, *Free to leave*. A narrow window shortens it on its own, down to the meter alone.
- **A click** opens the details: the week (done, objective, remaining), today (arrival, what Quelio counts so far, lunch, what is left, the suggested departure and the allowed window) and each day of the week.
- **It moves with the clock.** Quelio is asked about once an hour during the working day, and not at night or at the weekend; how long lunch has lasted and what is left today are worked out locally from the last answer, so the bar is never an hour behind.

## Setting it up

1. Install and switch on Quelio from the Browse shelf.
2. Click **Quelio · Sign in** in the top bar. The first time, it asks for your company's **quelio-api address** — the server, ending in a slash, such as `https://example.com/quelio-api/`. It is kept in the plugin's settings, where you can change it.
3. Sign in with your Quelio username and password.

The settings also choose how often to refresh (an hour at least), how much the bar shows — progress and today's status, progress and what is left, or progress only — and the company's rules, below.

## How the suggestion is made

The weekly objective is Quelio's own (`minutes_objective`, or 38 hours if it gives none). What is left is shared **evenly** over the working days left in the week, except that no day can hold more than it can — from the start to the end of the counted day, with an hour for lunch — and a day that cannot take its share hands the rest to the others. That share is today's objective. The suggested departure is when you reach it, never before the earliest departure nor after the latest.

If the hours left cannot be done even by staying as late as allowed on every day left, it says so, with what is missing, and suggests staying until the latest departure — never a time that breaks a rule.

## The rules

These are the defaults, and each one is a setting, so a company whose quelio-api is configured differently can match its own. A value that cannot be read (`8h30` rather than `08:30`) is replaced by its default. Times are `HH:MM`, lengths are minutes.

- **Only 08:30–18:30 is counted, 08:30–17:30 on Friday.** Badges outside count from or until those times, so the end is also the latest departure suggested.
- **Nobody leaves before 16:30**, any day, except with the afternoon off. A day that reaches its share earlier still ends at 16:30, and the time worked past the share lightens the days after it.
- **Arrive by 09:00.**
- **The two short breaks last 7 minutes each and are paid**: not taking them gives the time back, 14 minutes a day. Quelio credits the morning one only once 12:00 has passed and the afternoon one only from 16:00, so leaving just before loses its 7 minutes.
- **Lunch starts between 12:00 and 13:00 and counts as an hour at least.** Badging less does not let you leave earlier: the difference is deducted, up to the 14 minutes of breaks. Only the part of lunch between 12:00 and 14:00 counts toward its hour, so a lunch started at 11:50 has its hour up at 13:00, and coming back after 14:00 from a lunch started in time deducts nothing. 14:00 is also the latest return.
- **Paid = effective + breaks − what lunch fell short of its hour.**

A lunch started after 13:00 cannot reach its hour before 14:00, and nothing after 14:00 counts toward it, so the bar says to be back by 14:00 rather than an hour after it began.

The counting rules — what is counted, the breaks, the lunch window and its minimum — have to match the server's `config.php` (`start_limit_minutes`, `end_limit_minutes`, `pause_time`, `morning_break_threshold`, `afternoon_break_threshold`, `noon_break_start`, `noon_break_end`, `noon_minimum_break`); each setting's hint names its key. quelio-api has one end of day for every weekday, so a Friday ending earlier is planned for here without Quelio enforcing it. Where the two disagree, Quelio's count wins: today's figure follows its last answer, and only the progress since is computed locally.

**Days off.** In the details, a day with no badges can be marked as a day off: it counts for a fifth of the weekly objective and takes no hours. Any day can be marked as an **afternoon off**: it counts for a tenth of the objective, holds only a morning — ending by 13:00, with no lunch — and has no 16:30 floor. Both are kept for the current week only.

## What it sends, and where

- **One kind of request, to one address**: a `POST` to the quelio-api address in the settings, with `action=login` and your Quelio username plus either your password (once, to sign in) or the token Quelio returned. Nothing from Slack — no message, channel, workspace or Slack token — is ever sent.
- The request is made by BetterSlack's loader through `api.net`, because quelio-api sends no CORS headers and a page in Slack cannot read its answer. The manifest names the address setting under `network`, and the loader refuses any other address, plain http, and redirects.
- Each refresh makes Quelio sign in to Kelio, which is why quelio-api asks for no more than one call an hour. So the plugin asks only on working days, from half an hour before the counted day starts until it ends, plus once after the end to see the departure; never at night, and at the weekend only when it holds nothing for the week. A failure is waited out — longer each time, or as long as Quelio says after a 429 — and that wait, like the time of the last request, survives a restart or a change of settings. A refused password is never retried behind your back: five failures in five minutes block your whole network for a while.

## What it keeps, and how

- **Your password is not stored.** It leaves the form the moment you press Sign in, and is sent once.
- **The token Quelio returns contains it, though.** quelio-api builds the token from your username, your password encrypted with the server's key, and an unsalted SHA-256 hash of the password, so whoever holds the token can use it as you and can recover the password from it offline. Protect it like the password.
- **The token and this week's hours are kept in the plugin's own data folder**, `~/.betterslack/data/quelio/` (through `api.data`), so a restart does not ask you to sign in again — along with `throttle.json`, when Quelio was last asked and any failure being waited out. They are plain, unencrypted files. They are deliberately not in BetterSlack's settings file, which is copied into every BetterSlack backup and into the script every Slack page starts with.
- Your username, for the sign-in form, and the days and afternoons you marked off are in the settings file with the plugin's other settings.
- **Sign out** deletes the token, the hours and the username on this computer. Removing the plugin does not: BetterSlack keeps a plugin's data folder when the plugin goes, so sign out first. quelio-api cannot revoke a token remotely, so it stays valid on the server until Quelio invalidates it, which a failed Kelio sign-in or a password change does.
- When Quelio says the session is over, the plugin signs out and asks you to sign in again; it never retries with a token it knows is dead.

## Limits

- It reads the time from your computer's clock, which is the badge reader's for anyone in the same time zone.
- Between two refreshes, a badge you have just made is not known yet. The details say when the hours were last read, and **Refresh** asks again — at most every five minutes.

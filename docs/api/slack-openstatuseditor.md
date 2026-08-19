---
name: openStatusEditor
group: slack
title: api.slack
signature: (): Promise<boolean>
preview: slack-openstatuseditor
---

Slack's own "set a status" dialog. There is no deep link for it and no action a mod can dispatch: the entry lives in the account menu, so this opens the menu and then presses it.

Anchored on `data-qa="main-menu-custom-status-item"`, which is the same in every language — the label beside it is not, and matching on the words would work in English and quietly stop working in French.

It resolves false when the user button is not on the page or the menu never drew, rather than throwing: a dialog that could not be opened is not a reason to fail whatever asked for it.

```js
// The emoji beside your name in the account strip does exactly this.
const opened = await api.slack.openStatusEditor();
if (!opened) api.ui.toast('Slack did not open the status dialog', { variant: 'warn' });
```

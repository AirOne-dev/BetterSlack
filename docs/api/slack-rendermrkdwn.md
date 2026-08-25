---
name: renderMrkdwn
group: slack
title: Slack
signature: (text: string, options?: MrkdwnOptions): DocumentFragment
since: unreleased
preview: slack-rendermrkdwn
control: text | textarea | joyeux anniversaire à <@U04ED8UPV> qui fête ses 37 ans dans <#C01BQ8AG3|tech> :tada:\nle ticket : <https://github.com/anthropics/claude-code/issues/87575|#87575>, *urgent* et `bloquant` — merci &amp; bonne journée
control: shortLinks | boolean | false
control: oneLine | boolean | false
---

What Slack's API answers with is not what Slack draws. A mention arrives as `<@U04ED8UPV>`, a link as `<https://…|label>`, an ampersand as `&amp;`, and emphasis as the asterisks somebody typed — so anything showing a message as it came off the wire shows the wire.

Nodes, never a string of markup: this is somebody's message, and building HTML out of it to get a mention on screen would put their words through an HTML parser. The ids become names through the callbacks you pass, so whatever you already know about the workspace is what is drawn; `onChannel` and `onLink` make those pieces buttons rather than spans.

`shortLinks` shows a bare address by its host, for a row in a list where sixty characters of URL is the whole line. `oneLine` collapses whitespace and drops blockquote markers, for the same reason. `_italic_` is deliberately not emphasis: half the handles in a workspace are snake_case, and `deploy_from_main` would come out italic with the underscores eaten.

```js
line.append(api.slack.renderMrkdwn(message.text, {
  userName: (id) => people.get(id)?.name ?? null,
  channelName: (id) => channels.get(id) ?? null,
  emojiUrl: (name) => api.slack.emojiUrl(name, customEmoji),
  onChannel: (id) => api.slack.openConversation(id),
}));
```

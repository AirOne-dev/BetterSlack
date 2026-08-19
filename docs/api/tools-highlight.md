---
name: highlight · detect
group: tools
title: Tools
signature: highlight(code: string, language: string): string · detect(code: string): string | null
preview: tools-highlight
control: source | textarea | select channel, count(*) as messages from events group by channel;
control: language | select | auto | language | auto, javascript, typescript, python, sql, json, css, bash
---

Code Highlight's two halves. Slack sends a code block as plain grey text with nothing saying what is in it, so the language is worked out from the code itself — and `detect` answers null when it is not confident, which leaves the block alone rather than colouring it as the wrong language.

The lexer is written by hand: Slack's content policy forbids `eval`, so no off-the-shelf highlighter can run in the page.

```js
import { highlight } from './tokenise.js';
import { detect } from './detect.js';

const language = detect(block.textContent);
if (language) block.innerHTML = highlight(block.textContent, language);
```

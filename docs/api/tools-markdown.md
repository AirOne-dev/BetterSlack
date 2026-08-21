---
name: renderMarkdown
group: tools
title: Tools
signature: (source: string, options?: MarkdownOptions): string
since: 2.0.1
preview: tools-markdown
control: source | textarea | # Midnight\n\nA deeper, cooler dark with **design tokens** rather than class names.\n\n- one\n- two\n\n[Not a link](javascript:alert(1))
---

What the panel runs on a mod's README, and the reason a readme can be rendered at all: it escapes first and drops a `javascript:` URL, so nothing in a mod's markdown can execute.

Pictures are resolved through the mod's own folder and nothing else is fetched.

```js
import { renderMarkdown } from './markdown.js';

article.innerHTML = renderMarkdown(readme, {
  // a picture in a readme is a file in the mod's folder, and nothing else
  resolve: (href) => manager.asset(mod.id, href),
});
```

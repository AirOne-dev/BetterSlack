// Enough Markdown to render a mod's readme, and no more.
//
// Written here for the same reason the code highlighter is: Slack's CSP has no
// 'unsafe-eval', so every parser that builds its grammar at runtime is out, and
// pulling a dependency into the renderer bundle for a page of prose is a poor
// trade. What a mod's readme actually contains is headings, paragraphs, lists,
// links, pictures, code and emphasis -- so that is what this does.
//
// Everything is escaped before anything is wrapped. A readme comes from a mod
// folder, and a mod can come from somebody else's repository: this output goes
// through innerHTML, which makes the escaping the whole security story rather
// than a detail.

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Only ever a link somebody can follow, never a scheme that runs anything. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:|mailto:|slack:|data:image\/)/i.test(trimmed)) return trimmed;
  // A relative path is a file in the mod's own folder, which the caller
  // resolves; anything else -- javascript:, vbscript: -- is dropped outright.
  if (/^[\w./-]+$/.test(trimmed)) return trimmed;
  return null;
}

/** Inline marks, applied to text that is already escaped. */
function inline(text: string, resolve: (href: string) => string | null): string {
  return text
    // Code first: what is inside it is not markup.
    .replace(/`([^`]+)`/g, (_, code: string) => `<code class="sm-md__code">${code}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, href: string) => {
      const src = resolve(href);
      return src ? `<img class="sm-md__img" src="${src}" alt="${alt}">` : whole;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
      const url = resolve(href);
      return url ? `<a class="sm-md__link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : whole;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
}

export interface MarkdownOptions {
  /**
   * Turn a relative path into something the page can load.
   *
   * A readme in a mod folder writes `![](shots/panel.png)`, and only the caller
   * knows how to reach that -- through `mods.asset`, or a URL on the site.
   */
  resolve?: (href: string) => string | null;
}

/**
 * Markdown to HTML, escaped.
 *
 * Block-level parsing is a single pass over the lines, because the shapes that
 * matter here do not nest: a readme is not a document format, it is a page.
 */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): string {
  const resolve = options.resolve ?? ((href: string) => safeUrl(href));
  const lines = escapeHtml(source.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];

  let list: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];
  let fence: string[] | null = null;

  const closeParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '), resolve)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    out.push(`</${list}>`);
    list = null;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre class="sm-md__pre"><code>${fence.join('\n')}</code></pre>`);
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      closeParagraph();
      closeList();
      fence = [];
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1]!.length;
      out.push(`<h${level} class="sm-md__h${level}">${inline(heading[2]!, resolve)}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      closeParagraph();
      const wanted = bullet ? 'ul' : 'ol';
      if (list !== wanted) {
        closeList();
        list = wanted;
        out.push(`<${wanted} class="sm-md__list">`);
      }
      out.push(`<li>${inline((bullet ?? numbered)![1]!, resolve)}</li>`);
      continue;
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeParagraph();
      closeList();
      out.push('<hr class="sm-md__rule">');
      continue;
    }

    // `&gt;` and not `>`: the whole source is escaped before the blocks are
    // read, which is what keeps a readme from somebody else's repository from
    // reaching innerHTML with markup intact.
    if (/^\s*&gt;\s?/.test(line)) {
      closeParagraph();
      closeList();
      out.push(`<blockquote class="sm-md__quote">${inline(line.replace(/^\s*&gt;\s?/, ''), resolve)}</blockquote>`);
      continue;
    }

    if (line.trim() === '') {
      closeParagraph();
      closeList();
      continue;
    }
    paragraph.push(line.trim());
  }

  if (fence !== null) out.push(`<pre class="sm-md__pre"><code>${fence.join('\n')}</code></pre>`);
  closeParagraph();
  closeList();
  return out.join('\n');
}

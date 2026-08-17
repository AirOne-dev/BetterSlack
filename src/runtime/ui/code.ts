// A CSS editor that colours what you type.
//
// Every tool in this repository that takes CSS -- the theme builder, the custom
// stylesheet in the Mods panel -- was a bare <textarea>, which is where a
// missing brace goes unnoticed until the theme silently stops applying.
//
// The technique is the usual one, and it is the only one that works without
// reimplementing a text field: a <pre> painted underneath holds the highlighted
// copy, the <textarea> sits on top with transparent text and a visible caret,
// and the two are kept in the same place by giving them identical metrics and
// syncing scroll. Anything else -- contenteditable, a canvas -- loses undo,
// spellcheck, accessibility, or all three.
//
// The tokeniser is small on purpose. It has to be right about the things that
// hide a mistake (unterminated comments and strings swallow the rest of the
// file) and merely useful about the rest.

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function escape(text: string): string {
  return text.replace(/[&<>]/g, (char) => ESCAPES[char]!);
}

interface Token {
  kind: string;
  text: string;
}

/**
 * Split CSS into coloured pieces.
 *
 * Deliberately not a parser: it is a scanner that knows where a comment or a
 * string starts and ends, and inside a declaration block tells a property from
 * its value. That covers what a theme is made of.
 */
export function tokenizeCss(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let afterColon = false;
  /**
   * What each open brace was: a declaration block, or a block that holds more
   * rules. `@media`, `@supports` and friends are the second kind, and treating
   * them as the first paints every nested selector as if it were a property --
   * which is most of what a theme is made of.
   */
  const blocks: Array<'declarations' | 'rules'> = [];
  let atRule: string | null = null;
  const NESTS_RULES = /^@(media|supports|layer|container|document|scope)$/;
  const inBlock = () => blocks[blocks.length - 1] === 'declarations';

  const push = (kind: string, text: string) => {
    if (text) tokens.push({ kind, text });
  };

  while (index < source.length) {
    const rest = source.slice(index);

    // Comments first: everything inside one is a comment, including braces.
    if (rest.startsWith('/*')) {
      const end = source.indexOf('*/', index + 2);
      const stop = end === -1 ? source.length : end + 2;
      push('comment', source.slice(index, stop));
      index = stop;
      continue;
    }

    const char = rest[0]!;

    // Whitespace is never coloured, and giving it a span for nothing doubles
    // the size of the painted copy.
    if (/\s/.test(char)) {
      const match = /^\s+/.exec(rest)!;
      push('space', match[0]);
      index += match[0].length;
      continue;
    }

    if (char === '"' || char === "'") {
      // An unterminated string would otherwise colour the rest of the file,
      // which is a good way to notice you left one open.
      const match = new RegExp(`^${char}(?:\\\\.|[^${char}\\\\\\n])*${char}?`).exec(rest);
      const text = match ? match[0] : char;
      push('string', text);
      index += text.length;
      continue;
    }

    if (char === '{') {
      blocks.push(atRule && NESTS_RULES.test(atRule) ? 'rules' : 'declarations');
      atRule = null;
      afterColon = false;
      push('punct', char);
      index += 1;
      continue;
    }
    if (char === '}') {
      blocks.pop();
      atRule = null;
      afterColon = false;
      push('punct', char);
      index += 1;
      continue;
    }
    if (char === ':' && inBlock()) {
      afterColon = true;
      push('punct', char);
      index += 1;
      continue;
    }
    if (char === ';') {
      afterColon = false;
      atRule = null;
      push('punct', char);
      index += 1;
      continue;
    }

    if (char === '@') {
      const match = /^@[\w-]+/.exec(rest)!;
      atRule = match[0];
      push('at', match[0]);
      index += match[0].length;
      continue;
    }

    // A custom property is a property wherever it appears, including the
    // declaration of one, which is most of what a theme is.
    if (rest.startsWith('--') && (inBlock() || afterColon)) {
      const match = /^--[\w-]+/.exec(rest)!;
      push(afterColon ? 'value' : 'property', match[0]);
      index += match[0].length;
      continue;
    }

    if (char === '#' && /^#[0-9a-fA-F]{3,8}\b/.test(rest)) {
      const match = /^#[0-9a-fA-F]{3,8}/.exec(rest)!;
      push('colour', match[0]);
      index += match[0].length;
      continue;
    }

    // A digit has to be in there: `.a` is a class, not a number, and reading
    // it as one paints every selector in the file the colour of a length.
    if (/^-?(?:\d+\.?\d*|\.\d+)[\w%]*/.test(rest)) {
      const match = /^-?(?:\d+\.?\d*|\.\d+)[\w%]*/.exec(rest)!;
      push('number', match[0]);
      index += match[0].length;
      continue;
    }

    if (/[\w-]/.test(char)) {
      const match = /^[\w-]+/.exec(rest)!;
      const word = match[0];
      if (!inBlock()) push('selector', word);
      else if (afterColon) push(/^!?important$/i.test(word) ? 'important' : 'value', word);
      else push('property', word);
      index += word.length;
      continue;
    }

    if (char === '!') {
      const match = /^!\s*important/i.exec(rest);
      if (match) {
        push('important', match[0]);
        index += match[0].length;
        continue;
      }
    }

    push(inBlock() ? 'punct' : 'selector', char);
    index += 1;
  }

  return tokens;
}

/** The tokens as HTML, ready to sit under a transparent textarea. */
export function highlightCss(source: string): string {
  return tokenizeCss(source)
    .map(({ kind, text }) => (kind === 'space' ? escape(text) : `<span class="sm-tok-${kind}">${escape(text)}</span>`))
    .join('');
}

export interface CodeEditorOptions {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  /** Rows of text to show before scrolling. */
  rows?: number;
  readOnly?: boolean;
}

export interface CodeEditor {
  readonly node: HTMLElement;
  value(): string;
  set(value: string): void;
  focus(): void;
}

export function createCodeEditor(doc: Document, options: CodeEditorOptions = {}): CodeEditor {
  const wrap = doc.createElement('div');
  wrap.className = 'sm-code';
  if (options.rows) wrap.style.setProperty('--sm-code-rows', String(options.rows));

  const paint = doc.createElement('pre');
  paint.className = 'sm-code__paint';
  paint.setAttribute('aria-hidden', 'true');

  const area = doc.createElement('textarea');
  area.className = 'sm-code__input';
  area.spellcheck = false;
  area.value = options.value ?? '';
  if (options.placeholder) area.placeholder = options.placeholder;
  if (options.readOnly) area.readOnly = true;
  area.setAttribute('autocapitalize', 'off');
  area.setAttribute('autocomplete', 'off');

  const draw = () => {
    // The trailing newline matters: without it the painted copy is one line
    // shorter than the textarea and the last line drifts as you scroll.
    paint.innerHTML = `${highlightCss(area.value)}\n`;
  };

  area.addEventListener('input', () => {
    draw();
    options.onChange?.(area.value);
  });
  area.addEventListener('scroll', () => {
    paint.scrollTop = area.scrollTop;
    paint.scrollLeft = area.scrollLeft;
  });

  // Tab indents rather than leaving the field: this is an editor, and losing
  // your place mid-rule to move focus is not what anyone means by Tab here.
  area.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const { selectionStart, selectionEnd, value } = area;
    area.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    area.selectionStart = area.selectionEnd = selectionStart + 2;
    draw();
    options.onChange?.(area.value);
  });

  wrap.append(paint, area);
  draw();

  return {
    node: wrap,
    value: () => area.value,
    set(value: string) {
      area.value = value;
      draw();
    },
    focus: () => area.focus(),
  };
}

/**
 * The editor's stylesheet.
 *
 * Shipped apart from the rest of the kit because both places that take CSS need
 * it and only one of them wants the whole design system: the Mods panel renders
 * into Slack's own light DOM and borrows Slack's classes for everything else.
 * The colours fall back to the kit's variables when they are there and to
 * plain values when they are not, so this stands alone.
 *
 * No backticks anywhere in here. This is a template literal.
 */
export const CODE_CSS = `
.sm-code {
  position: relative;
  border-radius: 6px;
  border: 1px solid var(--sm-line, rgba(255, 255, 255, .13));
  background: var(--sm-bg, transparent);
  overflow: hidden;
}
.sm-code:focus-within {
  border-color: var(--sm-focus, #1264a3);
  box-shadow: 0 0 0 1px var(--sm-focus, #1264a3);
}
/* Every metric set on one is set on the other, or the caret drifts away from
   the text as you type. That is the whole trick. */
.sm-code__paint,
.sm-code__input {
  margin: 0;
  padding: 10px 12px;
  border: 0;
  font: 13px/1.6 var(--sm-mono, Monaco, Menlo, Consolas, monospace);
  tab-size: 2;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  min-height: calc(var(--sm-code-rows, 12) * 1.6em + 20px);
}
.sm-code__paint {
  position: absolute;
  inset: 0;
  overflow: auto;
  pointer-events: none;
  color: var(--sm-text, inherit);
}
.sm-code__input {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  resize: vertical;
  background: transparent;
  color: transparent;
  caret-color: var(--sm-bright, #f8f8f8);
  outline: none;
  overflow: auto;
}
.sm-code__input::selection { background: rgba(29, 155, 209, .35); color: transparent; }
.sm-code__input::placeholder { color: var(--sm-muted, #9a9b9d); }

.sm-tok-comment { color: #6b7075; font-style: italic; }
.sm-tok-selector { color: #78c2ff; }
.sm-tok-property { color: #b8bcc0; }
.sm-tok-value { color: inherit; }
.sm-tok-string { color: #7ed492; }
.sm-tok-number { color: #f2a35e; }
.sm-tok-colour { color: #f2a35e; text-decoration: underline dotted rgba(242, 163, 94, .5); }
.sm-tok-at { color: #d78ef7; }
.sm-tok-important { color: var(--sm-danger, #e01e5a); font-weight: 700; }
.sm-tok-punct { color: #7d8286; }
`;

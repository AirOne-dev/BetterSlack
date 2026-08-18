// A tokeniser, written here rather than borrowed.
//
// Slack's CSP has no 'unsafe-eval', so every highlighter that compiles its
// grammars at runtime is out -- which is most of them. What is left is small
// and honest: one regular expression per language, built from a description of
// its comments, strings and keywords, scanned once over the text.
//
// It is a *lexer*, not a parser. It will colour the word `class` inside a
// sentence in a comment-free block of prose, and it does not know that
// `function` is not a keyword in a language it guessed wrong. For code in a
// chat message, at the size people paste, that trade is the right way round:
// nothing here can be slower than the message it is colouring.

/** Escape once, at the boundary, so nothing downstream has to think about it. */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const words = (list) => list.join('|');

/*
 * A language is a handful of patterns in priority order. Order matters more
 * than the patterns do: a keyword inside a string is a string, so strings and
 * comments have to win, and they are matched first.
 */
function spec({ line, block, strings = `"'`, keywords = [], builtins = [], extra = [], early = [] }) {
  const parts = [];
  // Before the strings, for the languages where a string in one position is
  // not a string: a JSON key is quoted and is not a value.
  parts.push(...early);
  if (block) parts.push(`(?<comment1>${block[0]}[\\s\\S]*?(?:${block[1]}|$))`);
  if (line) parts.push(`(?<comment2>${line}[^\\n]*)`);
  for (const q of strings) {
    const e = q === '`' ? '`' : q;
    parts.push(`(?<string${strings.indexOf(q)}>${e}(?:\\\\.|[^\\\\${e === '`' ? '`' : e}])*${e}?)`);
  }
  parts.push(...extra);
  parts.push('(?<number>\\b(?:0[xXbBoO][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)');
  if (keywords.length) parts.push(`(?<keyword>\\b(?:${words(keywords)})\\b)`);
  if (builtins.length) parts.push(`(?<builtin>\\b(?:${words(builtins)})\\b)`);
  // A name immediately before a bracket reads as a call wherever it appears.
  parts.push('(?<fn>\\b[A-Za-z_$][\\w$]*(?=\\s*\\())');
  parts.push('(?<punct>[{}()\\[\\];,.:=+\\-*/%<>!&|^~?]+)');
  return new RegExp(parts.join('|'), 'g');
}

const JS_KEYWORDS = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'as',
  'default', 'async', 'await', 'yield', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'in', 'of', 'delete', 'void', 'switch', 'case'];
const JS_BUILTINS = ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'console', 'window',
  'document', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise', 'Math', 'JSON', 'Map', 'Set'];

export const LANGUAGES = {
  javascript: spec({ line: '//', block: ['/\\*', '\\*/'], strings: `"'\``, keywords: JS_KEYWORDS, builtins: JS_BUILTINS }),
  typescript: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: `"'\``,
    keywords: [...JS_KEYWORDS, 'interface', 'type', 'enum', 'implements', 'readonly', 'public',
      'private', 'protected', 'abstract', 'declare', 'namespace', 'satisfies', 'keyof'],
    builtins: [...JS_BUILTINS, 'string', 'number', 'boolean', 'any', 'unknown', 'never', 'void'],
  }),
  python: spec({
    line: '#', strings: `"'`,
    keywords: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
      'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'yield',
      'global', 'nonlocal', 'pass', 'assert', 'del', 'async', 'await', 'not', 'and', 'or', 'is', 'in'],
    builtins: ['True', 'False', 'None', 'self', 'cls', 'print', 'len', 'range', 'dict', 'list', 'set',
      'tuple', 'str', 'int', 'float', 'bool', 'open', 'super'],
  }),
  json: spec({
    strings: '"',
    early: ['(?<property>"(?:\\\\.|[^"\\\\])*"(?=\\s*:))'],
    builtins: ['true', 'false', 'null'],
  }),
  bash: spec({
    line: '#', strings: `"'`,
    keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
      'function', 'return', 'export', 'local', 'source'],
    builtins: ['echo', 'cd', 'ls', 'cat', 'grep', 'sed', 'awk', 'curl', 'git', 'npm', 'pnpm', 'yarn',
      'docker', 'kubectl', 'sudo', 'mkdir', 'rm', 'cp', 'mv', 'chmod', 'ssh'],
    extra: ['(?<variable>\\$\\{?[A-Za-z_][\\w]*\\}?|\\$\\d)'],
  }),
  sql: spec({
    line: '--', block: ['/\\*', '\\*/'], strings: `'"`,
    keywords: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
      'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
      'GROUP', 'ORDER', 'BY', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS',
      'NULL', 'DISTINCT', 'UNION', 'WITH', 'RETURNING', 'select', 'from', 'where', 'insert', 'into',
      'update', 'delete', 'join', 'group', 'order', 'by', 'limit', 'and', 'or', 'not', 'null'],
    builtins: ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NOW', 'count', 'sum', 'avg'],
  }),
  go: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: `"\``,
    keywords: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case',
      'default', 'break', 'continue', 'go', 'defer', 'chan', 'select', 'type', 'struct', 'interface',
      'map', 'var', 'const'],
    builtins: ['nil', 'true', 'false', 'error', 'string', 'int', 'int64', 'float64', 'bool', 'byte',
      'make', 'new', 'len', 'cap', 'append', 'panic', 'recover', 'fmt'],
  }),
  rust: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: '"',
    keywords: ['fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait', 'pub', 'use',
      'mod', 'match', 'if', 'else', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue',
      'move', 'ref', 'where', 'async', 'await', 'dyn', 'unsafe', 'crate', 'self'],
    builtins: ['Some', 'None', 'Ok', 'Err', 'Option', 'Result', 'Vec', 'String', 'str', 'bool', 'u8',
      'u32', 'u64', 'i32', 'i64', 'f64', 'usize', 'println', 'true', 'false'],
  }),
  java: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: `"'`,
    keywords: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements',
      'static', 'final', 'void', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch',
      'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package',
      'abstract', 'synchronized', 'this', 'super', 'instanceof'],
    builtins: ['String', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'true', 'false',
      'null', 'System', 'List', 'Map', 'Integer', 'Object'],
  }),
  php: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: `"'`,
    keywords: ['function', 'class', 'public', 'private', 'protected', 'static', 'return', 'if',
      'else', 'elseif', 'foreach', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new',
      'use', 'namespace', 'extends', 'implements', 'try', 'catch', 'finally', 'throw', 'echo'],
    builtins: ['true', 'false', 'null', 'array', 'string', 'int', 'bool', 'this', 'self'],
    extra: ['(?<variable>\\$[A-Za-z_]\\w*)'],
  }),
  css: spec({
    block: ['/\\*', '\\*/'], strings: `"'`,
    extra: ['(?<selector>^[^\\n{}]+(?=\\s*\\{))', '(?<property>[-\\w]+(?=\\s*:))', '(?<variable>--[\\w-]+)'],
    builtins: ['important', 'inherit', 'initial', 'none', 'auto', 'var', 'calc', 'rgb', 'rgba'],
  }),
  html: spec({
    block: ['<!--', '-->'], strings: `"'`,
    extra: ['(?<tag><\\/?[A-Za-z][\\w:-]*)', '(?<attr>\\s[A-Za-z-]+(?=\\s*=))'],
  }),
  yaml: spec({
    line: '#', strings: `"'`,
    extra: ['(?<property>^\\s*[-\\w.]+(?=\\s*:))', '(?<punct2>^\\s*-\\s)'],
    builtins: ['true', 'false', 'null', 'yes', 'no'],
  }),
  graphql: spec({
    line: '#', strings: '"',
    keywords: ['query', 'mutation', 'subscription', 'fragment', 'on', 'type', 'input', 'enum',
      'interface', 'union', 'scalar', 'schema', 'extend', 'implements', 'directive'],
    builtins: ['ID', 'String', 'Int', 'Float', 'Boolean', 'true', 'false', 'null'],
    early: ['(?<property>\\b[A-Za-z_]\\w*(?=\\s*:))', '(?<variable>\\$\\w+)', '(?<meta>@\\w+)'],
  }),
  kotlin: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: `"'`,
    keywords: ['fun', 'val', 'var', 'class', 'object', 'interface', 'data', 'sealed', 'when', 'if',
      'else', 'for', 'while', 'return', 'import', 'package', 'override', 'suspend', 'companion',
      'private', 'public', 'internal', 'lateinit', 'init'],
    builtins: ['String', 'Int', 'Long', 'Double', 'Boolean', 'List', 'Map', 'true', 'false', 'null', 'it', 'this'],
  }),
  swift: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: '"',
    keywords: ['func', 'let', 'var', 'class', 'struct', 'enum', 'protocol', 'extension', 'guard',
      'if', 'else', 'for', 'while', 'return', 'import', 'switch', 'case', 'defer', 'init', 'self',
      'private', 'public', 'internal', 'static', 'override', 'async', 'await', 'throws', 'try'],
    builtins: ['String', 'Int', 'Double', 'Bool', 'Array', 'Dictionary', 'true', 'false', 'nil', 'print'],
  }),
  ruby: spec({
    line: '#', strings: `"'`,
    keywords: ['def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while', 'until',
      'do', 'return', 'require', 'require_relative', 'yield', 'begin', 'rescue', 'ensure', 'then',
      'case', 'when', 'attr_accessor', 'attr_reader'],
    builtins: ['nil', 'true', 'false', 'self', 'puts', 'new', 'nil?', 'each', 'map'],
    extra: ['(?<variable>[@$]\\w+)', '(?<meta>:\\w+)'],
  }),
  c: spec({
    line: '//', block: ['/\\*', '\\*/'], strings: `"'`,
    keywords: ['int', 'char', 'float', 'double', 'void', 'long', 'short', 'unsigned', 'signed',
      'struct', 'union', 'enum', 'typedef', 'static', 'const', 'extern', 'return', 'if', 'else',
      'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'goto', 'sizeof',
      'class', 'namespace', 'template', 'public', 'private', 'protected', 'virtual', 'new', 'delete'],
    builtins: ['NULL', 'true', 'false', 'printf', 'malloc', 'free', 'std', 'cout', 'string', 'vector'],
    extra: ['(?<meta>^\\s*#\\s*\\w+)'],
  }),
  dockerfile: spec({
    line: '#', strings: `"'`,
    keywords: ['FROM', 'RUN', 'CMD', 'LABEL', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME',
      'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'HEALTHCHECK', 'SHELL', 'AS'],
    extra: ['(?<variable>\\$\\{?\\w+\\}?)'],
  }),
  toml: spec({
    line: '#', strings: `"'`,
    extra: ['(?<selector>^\\s*\\[+[^\\]\\n]+\\]+)', '(?<property>^\\s*[\\w.-]+(?=\\s*=))'],
    builtins: ['true', 'false'],
  }),
  diff: spec({
    extra: ['(?<added>^\\+[^\\n]*)', '(?<removed>^-[^\\n]*)', '(?<meta>^@@[^\\n]*|^diff [^\\n]*)'],
  }),
};

/** Groups that are only there to be matched, and share a colour. */
const ALIAS = {
  comment1: 'comment', comment2: 'comment',
  string0: 'string', string1: 'string', string2: 'string',
  punct2: 'punct', property: 'property', selector: 'selector',
};

/**
 * Turn code into HTML, already escaped.
 *
 * Returns the text untouched (escaped) for a language it does not know, which
 * is what a caller wants: better plain than wrong.
 */
export function highlight(code, language) {
  const pattern = LANGUAGES[language];
  if (!pattern) return escapeHtml(code);

  let out = '';
  let last = 0;
  pattern.lastIndex = 0;
  // `m` is needed by the anchored patterns (diff, yaml, css selectors) and
  // harmless to the rest; set here rather than in every spec.
  const rx = new RegExp(pattern.source, 'gm');
  for (let m = rx.exec(code); m !== null; m = rx.exec(code)) {
    // A zero-width match would spin forever; the sticky index has to move.
    if (m[0] === '') { rx.lastIndex += 1; continue; }
    const name = Object.keys(m.groups).find((k) => m.groups[k] !== undefined);
    if (!name) continue;
    out += escapeHtml(code.slice(last, m.index));
    out += `<span class="bshl-${ALIAS[name] ?? name}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(code.slice(last));
}

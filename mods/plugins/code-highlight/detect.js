// Working out what a block of code is, from the code alone.
//
// Slack's composer has no language selector: a ``` block arrives as text and
// nothing else. So the language has to be guessed, and a guess that is wrong
// is worse than no colour at all -- it paints half the words and misses the
// rest, which reads as a bug rather than as a limitation.
//
// Hence the shape of this: every language scores itself on signatures that are
// hard to write by accident, the best score wins, and a score under the floor
// wins nothing. Ties go to the earlier entry, which is why the list is ordered
// by how distinctive the signatures are rather than alphabetically.

const SIGNS = [
  ['diff', [
    [/^@@ -\d+.* \+\d+.* @@/m, 6],
    [/^diff --git /m, 6],
    [/^[+-][^+-]/m, 2],
  ]],
  ['graphql', [
    [/\b(query|mutation|subscription)\s+\w*\s*[({]/, 6],
    [/^\s*(type|input|enum|interface|scalar|union)\s+\w+\s*[{@]/m, 6],
    [/\bfragment \w+ on \w+/, 6],
    [/^\s*\w+(\(.*\))?\s*:\s*\[?[A-Z]\w*!?\]?!?\s*$/m, 3],
    [/[;=]\s*$/m, -3],
  ]],
  ['dockerfile', [
    [/^\s*FROM\s+\S+/m, 7],
    [/^\s*(RUN|CMD|COPY|ADD|ENTRYPOINT|WORKDIR|EXPOSE|ENV)\s+/m, 3],
  ]],
  ['toml', [
    [/^\s*\[[\w.-]+\]\s*$/m, 5],
    [/^\s*[\w.-]+\s*=\s*["\d[]/m, 3],
  ]],
  ['ruby', [
    [/^\s*def \w+[!?]?/m, 4],
    [/^\s*end\s*$/m, 4],
    [/\b(require|require_relative|attr_accessor|puts)\b/, 3],
    [/\b(nil|elsif|unless)\b/, 3],
    [/[;{]\s*$/m, -2],
  ]],
  ['kotlin', [
    [/\bfun \w+\s*\(/, 5],
    [/\b(val|var) \w+\s*[:=]/, 3],
    [/\b(data class|sealed class|companion object|suspend fun)\b/, 5],
  ]],
  ['swift', [
    [/\bfunc \w+\s*\(/, 4],
    [/\b(guard|let|var) .*\bin\b|\bguard let\b/, 3],
    [/@(objc|IBOutlet|State|Published)\b/, 5],
    [/\bprint\(".*"\)/, 2],
    [/\bnil\b/, 2],
  ]],
  ['c', [
    [/^\s*#\s*(include|define|ifndef|pragma)\b/m, 7],
    [/\b(int|void|char|float|double)\s+\w+\s*\([^)]*\)\s*\{/, 4],
    [/\bstd::|\bcout\s*<</, 5],
    [/\bprintf\s*\(/, 3],
  ]],
  ['json', [
    [/^\s*[{[]/, 2],
    [/"[^"]*"\s*:/, 3],
    // Two quoted keys rather than one. People paste fragments -- a slice of a
    // payload that starts mid-object -- and a fragment has no opening brace to
    // score on; measured against a real message that was being missed.
    [/"[^"]*"\s*:[\s\S]*?"[^"]*"\s*:/, 3],
    [/[}\]]\s*$/, 1],
    [/\b(function|def|const|SELECT)\b/i, -6],
  ]],
  ['html', [
    [/<\/[a-z][\w-]*>/i, 4],
    [/^\s*<(!doctype|html|div|span|p|body|head|script)\b/im, 4],
    [/<[a-z][\w-]*\s+[a-z-]+=/i, 2],
  ]],
  ['css', [
    [/^[^\n{}]+\{[^}]*:[^}]*;/m, 4],
    [/(^|\n)\s*(--[\w-]+|[a-z-]+)\s*:\s*[^;]+;/, 2],
    [/@(media|import|keyframes|supports)\b/, 3],
    [/\b(function|def|return)\b/, -4],
  ]],
  ['sql', [
    [/\bselect\b[\s\S]*\bfrom\b/i, 6],
    [/\b(insert into|update .* set|delete from|create table|alter table)\b/i, 6],
    [/\b(inner|left|right) join\b/i, 3],
  ]],
  ['bash', [
    [/^#!\/(bin|usr)/, 8],
    [/^\s*\$ /m, 4],
    [/\b(sudo|apt-get|brew install|chmod|mkdir -p|rm -rf)\b/, 4],
    [/\b(npm|pnpm|yarn|git|docker|kubectl) [a-z]/, 3],
    [/\$\{?\w+\}?/, 1],
    [/[;{}]\s*$/m, -1],
  ]],
  ['python', [
    [/^\s*def \w+\s*\(.*\)\s*:/m, 6],
    [/^\s*(from|import) [\w.]+/m, 3],
    [/^\s*class \w+.*:/m, 4],
    [/\b(elif|None|True|False|self)\b/, 3],
    [/\bprint\(/, 2],
    [/[;{]\s*$/m, -3],
  ]],
  ['go', [
    [/^\s*package \w+/m, 6],
    [/\bfunc \w*\s*\(/, 5],
    [/:=/, 3],
    [/\b(nil|struct|interface\{\})\b/, 2],
  ]],
  ['rust', [
    [/\bfn \w+\s*\(/, 5],
    [/\blet (mut )?\w+/, 3],
    [/\b(Some|None|Ok|Err)\(/, 4],
    [/->\s*\w+|::\w+/, 2],
    [/println!/, 4],
  ]],
  ['php', [
    [/<\?php/, 8],
    [/\$this->/, 5],
    [/\$\w+\s*=/, 3],
    [/\b(echo|namespace|use [\w\\]+;)\b/, 2],
  ]],
  ['java', [
    [/\b(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*\(/, 5],
    [/\bSystem\.out\.print/, 6],
    [/^\s*(package|import)\s+[\w.]+;/m, 4],
    [/\bnew [A-Z]\w*\(/, 2],
  ]],
  ['typescript', [
    [/\binterface \w+\s*\{/, 5],
    [/:\s*(string|number|boolean|void|any|unknown)\b/, 4],
    [/\btype \w+\s*=/, 4],
    [/\b(readonly|implements|enum)\b/, 2],
    [/\bimport .* from ['"]/, 1],
  ]],
  ['javascript', [
    [/\b(const|let)\s+\w+\s*=/, 3],
    [/=>/, 2],
    [/\bfunction\s*\w*\s*\(/, 3],
    [/\b(console\.log|require\(|module\.exports)/, 4],
    [/\bimport .* from ['"]/, 2],
    [/:\s*(string|number|boolean)\b/, -2],
  ]],
  ['yaml', [
    [/^\s*[-\w.]+:\s*($|[^\s{[])/m, 3],
    // Two key lines rather than one: a single `word:` is a sentence in half the
    // messages ever written, and was scoring the same as a config file.
    [/^\s*[-\w.]+:\s*($|[^\s{[])[\s\S]*?^\s*[-\w.]+:\s*($|[^\s{[])/m, 3],
    [/^\s*- \w/m, 2],
    [/^---\s*$/m, 4],
    [/[{};]/, -2],
  ]],
];

/** Below this, nothing is confident enough to be worth colouring. */
const FLOOR = 4;

/**
 * The language of a block, or null when nothing is sure enough.
 *
 * Null is a real answer and the caller must honour it: a block of prose, a
 * stack trace or a table of numbers is not code, and painting keywords through
 * it is worse than leaving it grey.
 */
export function detect(code) {
  const text = code.slice(0, 4000);
  if (text.trim().length < 12) return null;

  let best = null;
  let bestScore = 0;
  for (const [language, signs] of SIGNS) {
    let score = 0;
    for (const [pattern, weight] of signs) if (pattern.test(text)) score += weight;
    if (score > bestScore) { bestScore = score; best = language; }
  }
  return bestScore >= FLOOR ? best : null;
}

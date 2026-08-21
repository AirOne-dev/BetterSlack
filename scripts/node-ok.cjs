/*
 * Does the Node running this file satisfy package.json's engines?
 *
 * Exit 0 and print a sortable version key if it does, exit 1 and say what is
 * wanted if it does not. The installers use it twice over: to decide whether a
 * Node already on the machine can be used at all, and to pick the newest among
 * several that can.
 *
 * Two rules shape every line of it.
 *
 * It reads the range out of package.json rather than repeating it. Two answers
 * to "which Node does this project need" is one answer too many, and the copy
 * nobody remembers to edit is always the one the user meets.
 *
 * And it is ES5 and CommonJS, with no arrow functions, no template literals and
 * no `let`. It has to run on the Node it is judging -- including one far too old
 * to be used, which is the entire point. Anything newer in here and an old Node
 * fails on a syntax error instead of being told, politely, that it is old.
 */

var fs = require('fs');
var path = require('path');

var manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
var range = manifest.engines.node;

var parts = process.versions.node.split('.');
var major = +parts[0];
var minor = +parts[1];
var patch = +parts[2];

/*
 * The subset of semver that engines.node actually uses: a caret on a minor
 * ("^20.19.0" -- that major, at or above that minor) and a floor on a major
 * (">=24.0.0" -- that major or anything later). A clause in neither shape is
 * not silently ignored: it fails loudly, because a range this cannot read is a
 * range it would otherwise wave through.
 */
var satisfied = range.split('||').map(function (clause) {
  var caret = clause.replace(/^\s+|\s+$/g, '').match(/^\^(\d+)\.(\d+)\./);
  if (caret) return major === +caret[1] && minor >= +caret[2];
  var floor = clause.replace(/^\s+|\s+$/g, '').match(/^>=(\d+)\./);
  if (floor) return major >= +floor[1];
  console.error('cannot read the engines.node clause "' + clause + '"');
  process.exit(2);
  return false;
});

var ok = satisfied.some(function (value) { return value; });

if (!ok) {
  /* Not "too old": 23.x is newer than 22.x and still outside every clause. */
  console.error('Node ' + process.versions.node + ' is not supported: BetterSlack needs ' + range + '.');
  process.exit(1);
}

/* One number, so a shell can compare candidates with -gt and no version math. */
process.stdout.write(String(major * 1000000 + minor * 1000 + patch));

import assert from "node:assert/strict";
import { parseStatus, describeStatus } from "../extensions/status.mjs";

// porcelain=v2 -z: NUL-separated records
const s = parseStatus(
	"1 .M N... 100644 100644 100644 abc123 def456 README.md\0" +
		"? testing\0" +
		"1 A. N... 100644 000000 100644 000000 e78900 staged.ts\0" +
		"1 MM N... 100644 100644 100644 aaa111 bbb222 both.ts\0" +
		"2 R. N... 100644 100644 100644 ccc333 ddd444 R100 new name.md\0old name.md\0" +
		"",
);

assert.equal(s.length, 5);
assert.deepEqual(s[0], { x: " ", y: "M", path: "README.md", untracked: false });
assert.deepEqual(s[1], { x: "?", y: "?", path: "testing", untracked: true });
assert.deepEqual(s[2], { x: "A", y: " ", path: "staged.ts", untracked: false });
assert.deepEqual(s[3], { x: "M", y: "M", path: "both.ts", untracked: false });
assert.deepEqual(s[4], { x: "R", y: " ", path: "new name.md", untracked: false });

// path containing spaces survives (v2 -z keeps them raw)
const spaced = parseStatus("1 M. N... 100644 100644 100644 abc def my file (v2).md\0");
assert.equal(spaced[0].path, "my file (v2).md");

assert.equal(parseStatus("").length, 0);
assert.equal(parseStatus("\0").length, 0);

assert.equal(describeStatus(s[0]), "modified");
assert.equal(describeStatus(s[1]), "untracked");
assert.equal(describeStatus(s[2]), "added");
assert.equal(describeStatus(s[3]), "staged+modified");

console.log("ok: status parser");

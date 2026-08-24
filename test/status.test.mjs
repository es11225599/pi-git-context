import assert from "node:assert/strict";
import { parseStatus, describeStatus } from "../extensions/status.mjs";

// includes CRLF line endings — Windows git output; trailing \r must be stripped
const s = parseStatus(" M a.txt\r\n?? new.txt\nA  staged.ts\nMM both.ts\n");

assert.deepEqual(s[0], { x: " ", y: "M", path: "a.txt", untracked: false });
assert.deepEqual(s[1], { x: "?", y: "?", path: "new.txt", untracked: true });
assert.deepEqual(s[2], { x: "A", y: " ", path: "staged.ts", untracked: false });
assert.deepEqual(s[3], { x: "M", y: "M", path: "both.ts", untracked: false });
assert.equal(s.length, 4);

assert.equal(parseStatus("").length, 0);
assert.equal(parseStatus("\n").length, 0);

assert.equal(describeStatus(s[0]), "modified");
assert.equal(describeStatus(s[1]), "untracked");
assert.equal(describeStatus(s[2]), "added");
assert.equal(describeStatus(s[3]), "staged+modified");

console.log("ok: status parser");

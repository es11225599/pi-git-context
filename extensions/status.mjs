// Pure parsing of `git status --porcelain` (v1). Kept dependency-free so tests run on plain node.

export function parseStatus(out) {
	// ponytail: strips trailing \r only (Windows git); embedded \r elsewhere untouched
	const lines = out.split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
	// ponytail: quoted paths keep escape sequences raw (\xxx octal from git); upgrade when non-ASCII filenames matter
	return lines.map((line) => {
		let path = line.slice(3);
		const quoted = /^"(.*)"$/.exec(path);
		if (quoted) path = quoted[1];
		return { x: line[0], y: line[1], path, untracked: line[0] === "?" };
	});
}

export function describeStatus(e) {
	if (e.untracked) return "untracked";
	if (e.x === "U" || e.y === "U" || (e.x === "A" && e.y === "A")) return "conflict";
	if (e.x === "A" || e.y === "A") return "added";
	if (e.x === "D" || e.y === "D") return "deleted";
	if (e.x === "R") return "renamed";
	if (e.x === "M" && e.y === "M") return "staged+modified";
	if (e.y === " ") return "staged";
	return "modified";
}

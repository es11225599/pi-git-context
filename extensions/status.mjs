// Pure parsing of `git status --porcelain=v2 -z` output. Dependency-free; tests run on plain node.
//
// Record shapes (NUL-terminated, no quoting):
//   ? <path>
//   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
//   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X> <score> <path> \0 <origPath>
//   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>

export function parseStatus(out) {
	const fields = out.split("\0");
	const entries = [];

	for (let i = 0; i < fields.length; i++) {
		const rec = fields[i];
		if (!rec) continue;
		const kind = rec[0];

		if (kind === "?") {
			entries.push({ x: "?", y: "?", path: rec.slice(2), untracked: true });
			continue;
		}
		if (kind !== "1" && kind !== "2" && kind !== "u") continue;

		const xy = rec.slice(2, 4);
		const segs = rec.split(" ");
		let path;

		if (kind === "1") {
			// 1 XY sub mH mI mW hH hI <path>
			path = segs.slice(8).join(" ");
		} else if (kind === "2") {
			// 2 XY sub mH mI mW hH hI X<score> <path>, origPath in next NUL field
			path = segs.slice(9).join(" ");
			i++;
		} else {
			// u XY sub m1 m2 m3 mW h1 h2 h3 <path>
			path = segs.slice(10).join(" ");
		}

		// v2 marks unmodified sides with "." — normalize to porcelain-v1-style " "
		const norm = (ch) => (ch === "." ? " " : ch);
		entries.push({
			x: norm(xy[0]),
			y: norm(xy[1]),
			path,
			untracked: false,
		});
	}

	return entries;
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

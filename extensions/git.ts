import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Key,
	matchesKey,
	SelectList,
	Text,
	type Component,
	type SelectItem,
} from "@earendil-works/pi-tui";
import { describeStatus, parseStatus } from "./status.mjs";

interface StatusEntry {
	x: string;
	y: string;
	path: string;
	untracked: boolean;
}

interface OpResult {
	ok: boolean;
	msg: string;
}

const exec = promisify(execFile);

const MAX_DIFF_LINES = 2000;
const VIEW_H = 28;
const SUBCOMMANDS = ["branch", "new-branch", "fetch", "pull", "changes"] as const;

// --- git plumbing -----------------------------------------------------------

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
	const { stdout } = await exec("git", args, { cwd, signal });
	return stdout.trim();
}

async function requireRoot(ctx: ExtensionCommandContext): Promise<string> {
	try {
		return await git(ctx.cwd, ["rev-parse", "--show-toplevel"]);
	} catch {
		throw new Error("not a git repository");
	}
}

function gitError(err: unknown): string {
	const e = err as { stderr?: string; message?: string };
	const first = e.stderr?.trim().split("\n")[0] || e.message || String(err);
	return first.trim();
}

async function refreshBranchStatus(ctx: { cwd: string; ui?: any }): Promise<void> {
	try {
		const root = await git(ctx.cwd, ["rev-parse", "--show-toplevel"]);
		let branch = await git(root, ["branch", "--show-current"]);
		if (!branch) branch = await git(root, ["rev-parse", "--short", "HEAD"]);
		const dirty = (await git(root, ["status", "--porcelain"])).split("\n").filter(Boolean).length;
		ctx.ui?.setStatus?.("git", `${branch} · ${dirty} changed`);
	} catch {
		ctx.ui?.setStatus?.("git", undefined);
	}
}

async function revertEntry(root: string, e: StatusEntry): Promise<void> {
	if (e.untracked) {
		await rm(join(root, e.path), { force: true, recursive: e.path.endsWith("/") });
	} else {
		// Match HEAD in index + worktree; added files become untracked instead of being deleted.
		await git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", e.path]);
	}
}

// --- panels -----------------------------------------------------------------

function selectDialog(ctx: ExtensionCommandContext, title: string, items: SelectItem[], hint?: string) {
	return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		if (hint) container.addChild(new Text(theme.fg("dim", hint), 1, 0));
		const list = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		});
		list.onSelect = (item) => done(item.value);
		list.onCancel = () => done(null);
		container.addChild(list);
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		// Container does not forward key input to children — route it manually.
		return {
			render(width: number) {
				return container.render(width);
			},
			invalidate() {
				container.invalidate();
			},
			handleInput(data: string) {
				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

// Run a long git operation inside a bordered spinner panel; Esc aborts (kills the child process).
function runInPanel(ctx: ExtensionCommandContext, message: string, op: (signal: AbortSignal) => Promise<OpResult>) {
	return ctx.ui.custom<OpResult | null>((tui, theme, _kb, done) => {
		const loader = new BorderedLoader(tui, theme, message);
		loader.onAbort = () => done(null);
		op(loader.signal)
			.then(done)
			.catch((err) => done({ ok: false, msg: gitError(err) }));
		return loader;
	});
}

// --- diff viewer ------------------------------------------------------------

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

function paint(line: string): string {
	if (line.startsWith("+")) return GREEN + line;
	if (line.startsWith("-")) return RED + line;
	if (line.startsWith("@@")) return CYAN + line;
	if (/^(diff |index |--- |\+\+\+ )/.test(line)) return DIM + line;
	return line;
}

async function diffLines(root: string, e: StatusEntry): Promise<string[]> {
	if (e.untracked) {
		if (e.path.endsWith("/")) return [`(untracked directory: ${e.path})`];
		try {
			const content = await readFile(join(root, e.path), "utf8");
			const lines = content.split("\n").slice(0, MAX_DIFF_LINES).map((l) => `+${l}`);
			lines.push(...(content.split("\n").length > MAX_DIFF_LINES ? ["(truncated)"] : []));
			return lines.length ? lines : ["(empty file)"];
		} catch {
			return ["(binary or unreadable file)"];
		}
	}
	try {
		const { stdout } = await exec("git", ["diff", "HEAD", "--", e.path], {
			cwd: root,
			maxBuffer: 16 * 1024 * 1024,
		});
		const lines = stdout.replace(/\n$/, "").split("\n").slice(0, MAX_DIFF_LINES);
		return lines.length && lines[0] !== "" ? lines : ["(no changes to show)"];
	} catch {
		return ["(failed to get diff)"];
	}
}

class DiffViewer implements Component {
	private top = 0;
	constructor(
		private title: string,
		private lines: string[],
		private onClose: (action: "close" | "revert") => void,
		private onChange: () => void,
	) {}

	handleInput(data: string): void {
		let d = 0;
		if (matchesKey(data, Key.down) || data === "j") d = 1;
		else if (matchesKey(data, Key.up) || data === "k") d = -1;
		else if (data === "G") this.top = Number.MAX_SAFE_INTEGER;
		else if (data === "g") this.top = 0;
		else if (matchesKey(data, Key.escape) || data === "q") return this.onClose("close");
		else if (data === "r") return this.onClose("revert");
		else return;
		this.top = Math.max(0, Math.min(this.top + d, Math.max(0, this.lines.length - (VIEW_H - 1))));
		this.onChange();
	}

	render(width: number): string[] {
		const visible = this.lines.slice(this.top, this.top + VIEW_H - 1);
		const header =
			` ${this.title} [${this.top + 1}-${Math.min(this.top + visible.length, this.lines.length)}/${this.lines.length}] ` +
			`j/k scroll · g/G ends · r revert · q close`;
		return [
			DIM + (header.length > width ? header.slice(0, width - 1) + "…" : header),
			...visible.map((l) => {
				const raw = l.length > width ? l.slice(0, width - 1) + "…" : l;
				return paint(raw);
			}),
		];
	}

	invalidate(): void {}
}

// --- subcommands ------------------------------------------------------------

async function cmdBranch(ctx: ExtensionCommandContext): Promise<void> {
	const root = await requireRoot(ctx);
	const current = await git(root, ["branch", "--show-current"]);
	const branches = (await git(root, ["branch", "--list", "--format=%(refname:short)"])).split("\n");
	if (!branches[0]) throw new Error("no branches found");
	const items: SelectItem[] = branches.map((b) => ({
		value: b,
		label: b === current ? `${b} ✓` : b,
	}));
	const pick = await selectDialog(ctx, "Branches", items, "Enter to switch · Esc to cancel");
	if (!pick || pick === current) return;
	await git(root, ["checkout", pick]);
	ctx.ui.notify(`Switched to ${pick}`, "info");
	await refreshBranchStatus(ctx);
}

async function cmdNewBranch(ctx: ExtensionCommandContext, nameArg: string): Promise<void> {
	const root = await requireRoot(ctx);
	let name = nameArg.trim() || ((await ctx.ui.input("New branch name:", "feature/my-change")) ?? "");
	name = name.trim();
	if (!name) return;
	if (/^-|[~^:?*\[\s\\]/.test(name)) throw new Error(`invalid branch name: ${name}`);
	await git(root, ["checkout", "-b", name]);
	ctx.ui.notify(`Created and switched to ${name}`, "info");
	await refreshBranchStatus(ctx);
}

async function cmdFetch(ctx: ExtensionCommandContext): Promise<void> {
	const root = await requireRoot(ctx);
	const res = await runInPanel(ctx, "Fetching all remotes…", async (signal) => {
		await git(root, ["fetch", "--all", "--prune"], signal);
		return { ok: true, msg: "Fetch complete" };
	});
	if (!res) return void ctx.ui.notify("Cancelled", "info");
	ctx.ui.notify(res.msg, res.ok ? "info" : "error");
}

async function cmdPull(ctx: ExtensionCommandContext): Promise<void> {
	const root = await requireRoot(ctx);
	const res = await runInPanel(ctx, "Pulling (fast-forward only)…", async (signal) => {
		await git(root, ["pull", "--ff-only"], signal);
		return { ok: true, msg: "Pull complete" };
	});
	if (!res) return void ctx.ui.notify("Cancelled", "info");
	if (res.ok) {
		ctx.ui.notify(res.msg, "info");
		await refreshBranchStatus(ctx);
	} else {
		ctx.ui.notify(`${res.msg} — resolve manually (merge/rebase) if diverged`, "warning");
	}
}

async function cmdChanges(ctx: ExtensionCommandContext): Promise<void> {
	const root = await requireRoot(ctx);
	let entries = parseStatus(await git(root, ["status", "--porcelain"]));
	if (!entries.length) {
		ctx.ui.notify("Working tree clean", "info");
		return;
	}
	while (true) {
		const items: SelectItem[] = entries.map((e, i) => ({
			value: String(i),
			label: e.path,
			description: describeStatus(e),
		}));
		const pick = await selectDialog(ctx, "Changed files", items, "Enter to view diff · Esc to exit");
		if (!pick) return;
		const idx = Number(pick);
		const entry = entries[idx];
		const lines = await diffLines(root, entry);
		const action = await ctx.ui.custom<"close" | "revert">(
			(tui, _theme, _kb, done) => new DiffViewer(entry.path, lines, done, () => tui.requestRender()),
			{ overlay: true },
		);
		if (action === "revert") {
			const ok = await ctx.ui.confirm(
				`Revert ${entry.path}?`,
				entry.untracked
					? "This untracked file will be permanently deleted. This cannot be undone."
					: "All uncommitted changes to this file will be discarded. This cannot be undone.",
			);
			if (ok) {
				await revertEntry(root, entry);
				ctx.ui.notify(`Reverted ${entry.path}`, "info");
				entries = entries.filter((_, i) => i !== idx);
				await refreshBranchStatus(ctx);
				if (!entries.length) {
					ctx.ui.notify("Working tree clean", "info");
					return;
				}
			}
		}
	}
}

// --- menu -------------------------------------------------------------------

const MENU_ITEMS: SelectItem[] = [
	{ value: "branch", label: "Branches…", description: "Switch local branch" },
	{ value: "new-branch", label: "New branch…", description: "Create and switch" },
	{ value: "fetch", label: "Fetch", description: "git fetch --all --prune" },
	{ value: "pull", label: "Pull", description: "git pull --ff-only" },
	{ value: "changes", label: "Changes…", description: "View diffs & revert files" },
];

async function runSubcommand(ctx: ExtensionCommandContext, sub: string, rest: string[]): Promise<void> {
	switch (sub) {
		case "branch":
			return cmdBranch(ctx);
		case "new-branch":
			return cmdNewBranch(ctx, rest.join("-"));
		case "fetch":
			return cmdFetch(ctx);
		case "pull":
			return cmdPull(ctx);
		case "changes":
			return cmdChanges(ctx);
		default:
			throw new Error(`unknown subcommand: ${sub}`);
	}
}

// Menu loops back after every action until Esc — re-showing fresh dialogs avoids stale references.
async function menuLoop(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const pick = await selectDialog(ctx, "Git", MENU_ITEMS, "What would you like to do? · Esc to exit");
		if (!pick) return;
		try {
			await runSubcommand(ctx, pick, []);
		} catch (err) {
			ctx.ui.notify(gitError(err), "error");
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("git", {
		description: "Git: branch | new-branch | fetch | pull | changes",
		getArgumentCompletions(prefix: string) {
			const items = SUBCOMMANDS.map((s) => ({ value: s, label: s }));
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length ? filtered : null;
		},
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			try {
				if (!sub) return await menuLoop(ctx);
				if (!(SUBCOMMANDS as readonly string[]).includes(sub)) {
					ctx.ui.notify(`Unknown subcommand "${sub}" — usage: /git <${SUBCOMMANDS.join("|")}>`, "info");
					return;
				}
				await runSubcommand(ctx, sub, rest);
			} catch (err) {
				ctx.ui.notify(gitError(err), "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await refreshBranchStatus(ctx);
	});
}

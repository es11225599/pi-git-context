# pi-git-context

Git commands for [pi](https://pi.dev) as a single `/git` command family with tab completion. Switch branches, sync with remotes, inspect working-tree changes, and reject unwanted edits without leaving the editor.

## Features

- **Branch context at a glance** — current branch and dirty-file count shown persistently in the footer status area
- **Branch switching** — pick from local branches with fuzzy-friendly select dialog (`✓` marks current)
- **New branches** — create and switch in one step, name via argument or prompt
- **Remote sync** — fetch all remotes with prune, pull with fast-forward-only safety
- **Change inspection** — list every dirty file with its status, view its diff in a scrollable colored overlay
- **Revert (reject changes)** — discard uncommitted changes per file, with explicit confirmation before anything destructive happens

## Requirements

- pi (any recent version with extension support)
- `git` on your PATH
- No npm dependencies — Node built-ins only

## Install

```bash
# From git
pi install git:github.com/es11225599/pi-git-context.git
pi install https://github.com/es11225599/pi-git-context   # raw URL works too

# From a local path
pi install /path/to/pi-git-context
```

For development against a working copy:

```bash
pi install /path/to/pi-git-context   # live edits, no reinstall needed
```

To try without installing the package, drop the extension into your global extensions directory:

```bash
cp extensions/git.ts ~/.pi/agent/extensions/
```

## Commands

All functionality lives under one command with tab-completed subcommands:

```
/git <subcommand>
```

| Subcommand | Action |
| --- | --- |
| `/git branch` | List local branches, select one, `git checkout`. Current branch marked `✓`. |
| `/git new-branch [name]` | `git checkout -b <name>`. Prompts interactively when no name given. Invalid ref names rejected up front. |
| `/git fetch` | `git fetch --all --prune`, result reported as notification. |
| `/git pull` | `git pull --ff-only`. On failure (diverged branch) shows git's first error line instead of creating surprise merge commits. |
| `/git changes` | List dirty files → pick one → diff overlay → optionally revert. |

Running `/git` with an unknown or missing subcommand prints usage.

## Diff viewer

Opened from `/git changes`. Keys:

| Key | Action |
| --- | --- |
| `j` / ↓ | Scroll down |
| `k` / ↑ | Scroll up |
| `g` | Jump to top |
| `G` | Jump to bottom |
| `r` | Revert this file (asks for confirmation first) |
| `q` / Esc | Close |

Diffs are syntax-colored by line type: additions green, deletions red, hunk headers cyan, file headers dimmed. Untracked files are previewed as if fully added. Large diffs are truncated at 2,000 lines.

## Revert semantics

What "revert" means depends on file state — the confirmation dialog always names the exact consequence before you accept:

| File state | Revert action |
| --- | --- |
| Modified / staged / deleted (tracked) | `git restore --source=HEAD --staged --worktree` — discards index and worktree changes permanently. This cannot be undone. |
| Added (newly tracked) | Same restore — file leaves index and stays on disk as untracked rather than being deleted. Content is preserved. |
| Untracked file | **Deleted permanently from disk.** This cannot be undone. |
| Untracked directory | **Deleted recursively and permanently.** This cannot be undone. |

## Footer status

On session start (and after any branch change or revert), the extension sets a persistent status entry rendered in the footer area:

```
main · 3 changed
```

Detached HEAD falls back to the short commit SHA. Outside a repository the status is cleared silently.

## Package layout

```
package.json            # pi manifest (extensions: ["./extensions"]), keyword "pi-package"
extensions/git.ts       # commands, dialogs, diff viewer, footer status
extensions/status.mjs   # pure `git status --porcelain` parser (dependency-free)
test/status.test.mjs    # parser self-check
```

## Development

```bash
node test/status.test.mjs   # run parser tests
```

The extension loads `.mjs` helpers so tests run on plain Node with zero tooling. Everything else uses only what pi injects (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`) plus Node built-ins.

## Known limitations

- Local branches only in `/git branch` (no remote branches, no delete/rename)
- No staging/unstaging — pairs well with running `git add` yourself or asking the agent
- Quoted paths in porcelain output (non-ASCII filenames) keep raw escape sequences

MIT licensed.

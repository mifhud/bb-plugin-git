# Git

A [BB](https://getbb.app) plugin that keeps a source-control panel open across threads: status, staging, commits, branches, sync, diffs, and history with a graph — the git feature set of [ompchamber](https://github.com/ompchamber/ompchamber), ported into a BB plugin shaped like [bb-plugin-file-tree](https://github.com/fzrx-ego/bb-plugin-file-tree).

## Install

```
bb plugin install git:https://github.com/<you>/bb-plugin-git.git@semver:^0.1.0
```

## Use

- The panel sits on the right of the BB window. Toggle it from the sidebar footer button, the thread header button, or `Git: show panel` in the command palette. Drag its left edge to resize; double-click the edge to reset the width.
- The first selector pins a workspace (a project source or the current thread's checkout) — switching threads keeps it, just like File Tree's pinned folder. The second selector picks a repository when the workspace nests several.
- **Changes tab** — commit box on top (⌘↵ commits), then Staged and Changes sections. Hover a row for stage `+`, unstage `−`, or discard `↺`; section headers stage/unstage/discard all. Click a file to open its diff. Rows can be shown as a list or a folder tree.
- **Diff viewer** — Unified and Split from one parser, `WS` folds whitespace-only pairs back into context, `Full` shows the whole file instead of the changed hunks.
- **Branch bar** — the branch menu switches between local and remote branches (checking out a remote creates the tracking branch) and creates new ones. The sync button pulls then pushes, showing `↑ahead ↓behind` against the upstream (the panel refreshes the tracking ref before counting, so the numbers describe origin rather than the last fetch).
- **Graph tab** — every branch, remote and tag newest-first in one colored lane graph, with refs badges and Load more paging. Open a commit for its files (`+n −n`) and copy its hash, then cherry-pick, revert, reset (soft/mixed/hard), merge, or rebase it. Cherry-pick only appears where git can apply it: a commit outside the current branch, not a merge, with a clean tree. Click a file to read its diff in that commit.
- Destructive operations (discard, hard reset) ask for confirmation first — the last git error stays visible in the panel until dismissed.

## Settings

```
bb plugin config git
```

- Show the Git panel when BB opens
- Ask before discarding changes
- Refresh changes automatically (every 5 seconds while the panel is open)

## Develop

```
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test — parser/graph/tree units
bb plugin build
bb plugin reload git
```

## How it works

Git runs server-side in the plugin process, on argv arrays — no shell string interpolation, so branch names, paths and commit messages cannot become commands. Paths from the client are re-resolved and confined to the working tree, hashes must be plain hex, branch names a conservative charset. The repository must live on BB's primary host; roots from a paired remote host are refused with a message instead of a wrong answer.

Feature logic is ported from ompchamber's `server/lib/fs/git-*` (status, log, diff, sync, repos) and `shared/lib/fs/*` (diff parser, graph lanes, status display), with `sh -c` invocations replaced by `execFile("git", argv)` and Bun APIs swapped for `node:` equivalents.

Author: [bb-plugin-git contributors](https://getbb.app)

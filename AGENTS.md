IMPORTANT global rules must include, read from AGENTS_global.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

**bb-plugin-git** is a [BB](https://getbb.app) plugin that shows a source-control panel across threads: status, stage/unstage/discard, commit, branches, push/pull/sync, diff viewer, and commit history with a graph. Git feature logic is ported from **ompchamber** (`src/server/lib/fs/git-*`, `src/shared/lib/fs/*`); the plugin skeleton, rail, pinned-root flow, and UI primitives come from **bb-plugin-file-tree**. Built with TypeScript, React 19, and Tailwind classes resolved against BB's host theme tokens.

## Common Commands

```bash
npm install           # Install dependencies
npm run typecheck     # tsc --noEmit (tests are excluded)
npm test              # node --test src/*.test.ts lib/*.test.ts
bb plugin build       # Build into dist/
bb plugin reload git  # Reload the plugin inside a running BB
```

## Architecture

### Entry Points

- **`server.ts`** — Plugin server entry. Defines settings, registers every RPC handler from `rpcContract`, resolves `rootId → path`, confines the `repo` selector to the pinned root, and enforces that the repo lives on BB's primary host.
- **`app.tsx`** — Frontend app. Registers `experimental_appOverlay` (GitRail), `experimental_threadHeaderAction`, `sidebarFooterAction`, and two `commandPaletteAction`s.
- There is **no host entry**: git runs in the plugin server process via `node:child_process`, unlike file-tree which delegates filesystem reads to the host.

### Contracts

- **`contract.ts`** — Zod schemas for all types (`GitChange`, `GitCommit`, `FileDiffData`, `GitStatus`, `RootChoice`, …) and the `rpcContract` every call goes through: `listRootChoices`, `workspaceForThread`, `listRepos`, `status`, `act`, `fileDiff`, `commits`, `commitDiff`, `clientLog`.

### Key Source Modules (`src/`)

- **`shell.ts`** — `runGit(args, {cwd,…})` on argv arrays (never a shell string), `gitOk`, `expectOk`.
- **`git-parse.ts`** — Pure parsers: `parsePorcelain` (status → changes) and `parseRefs` (for-each-ref → branch/lists). Pure so `node --test` can import them without spawning anything.
- **`git-status.ts`** — `readStatus`: spawns status + refs, handles detached HEAD and non-repositories.
- **`git-actions.ts`** — The `act` whitelist. Validates paths (containment under the repo), branch names (charset, no leading `-`), hashes (hex); implements stage/unstage/revert/commit/checkout/create_branch/push/pull/sync/cherry_pick/revert_commit/reset_commit/merge_commit/rebase_commit. `cherry_pick` refuses an ancestor of HEAD and a merge commit up front, so the repo is never left mid-pick.
- **`git-diff.ts`** — `fetchWorkingFileDiff`: working/index diff with staged/untracked/full-context handling.
- **`git-log.ts`** — `fetchGitCommits` (paged `--numstat` log over every branch, remote-tracking branch and tag — not just HEAD — with `COMMIT_SPLIT|~|` markers) and `fetchFileDiff` (show → diff-tree → blob fallbacks).
- **`git-sync.ts`** — Ahead/behind with a TTL'd background `git fetch` (60s TTL, 3s bounded wait, 15s kill deadline, process-group SIGKILL).
- **`git-repos.ts`** — Background nested-repo discovery, cached per root (`node_modules` pruned, depth ≤ 8).
- **`roots.ts` / `workspace.ts`** — Opaque `rootId` registry and thread/project workspace resolution (same pattern as file-tree).

### Lib (`lib/`) — shared, pure

- **`diff-parser.ts`** — Unified diff → unified lines + split rows + counts, one flush for both views (from ompchamber).
- **`git-graph.ts`** — Lane assignment, links, bezier paths (from ompchamber; one lane per branch arm, a parent pending in one lane only).
- **`commit-actions.ts`** — `reachableFromHead` (ancestry inside the loaded page) and `computeCherryPickState`: cherry-pick is shown only off-branch, on a non-merge, with a clean tree.
- **`git-status-display.ts`** — Status letter/label/color per code, folder rollups.
- **`git-tree.ts`** — Flat changes → folder tree.
- **`rail-state.ts` / `rail-width.ts` / `rail-inset.ts` / `portal-scope.ts`** — Rail open flag, width store, body inset, portal attributes (ported from file-tree; storage keys are `bb-plugin-git:*`).
- **`open-diff-panel.ts` / `diff-navigation.ts`** — The diff side-panel tab: its action id/params, and the per-thread navigator registry. The app overlay has no side panel, so `GitHeaderAction` registers the thread surface's `useBbNavigate` and the rail looks it up by threadId (the file-explorer pattern).

### Components (`components/`)

- **`GitRail.tsx`** — The window-wide rail: root/repo selectors, status polling (5s), action orchestration, confirm/prompt dialogs, tabs. A clicked file opens a diff side-panel tab via `openThreadPanel`, with the in-rail diff drawer as the fallback.
- **`GitDiffPanel.tsx`** — The side-panel tab body for a diff: resolves the persisted `rootKey` to a fresh `rootId` and renders `DiffView`.
- **`BranchToolbar.tsx`**, **`CommitBox.tsx`**, **`ChangesList.tsx`** (flat/tree rows), **`DiffView.tsx`** (unified/split/WS/full), **`HistoryView.tsx`** (the Graph tab: lane gutter + commit detail + commit actions), **`GitDialogs.tsx`**, **`GitHeaderAction.tsx`** (also registers this thread's navigator for diff tabs), **`RailResizeHandle.tsx`**.
- **`ui/`** — shadcn-style primitives copied verbatim from bb-plugin-file-tree (button, input, icon registry).

## Key Patterns

- **RPC everywhere**: the client never names a path or host; it sends `rootId` + repo-relative data and the server re-resolves and confines it.
- **argv, not sh -c**: every git invocation is `runGit([...])`. No argument is ever concatenated into a command string.
- **Errors are shown, not thrown away**: `act` returns `{ok:false, error}`; git's own stderr lands in the panel's error strip.
- **Polling**: status every 5s while open and visible (setting-gated); repo scan polls every 1.5s until `pending` clears.
- **Deps discipline**: `DiffView` keys its fetch effect on a primitive `targetKey` — a fresh `target` object arrives every render, and depending on the object would refetch forever.
- Path alias `@/*` → project root (tsconfig `paths`).

## Testing

- `node:test` + `node:assert/strict`, files `*.test.ts`, run by `npm test`.
- Test files import local modules with explicit `.ts` extensions (Node type stripping resolves no extensionless ESM paths); tests are excluded from `tsconfig.json`.

## Code Style

- TypeScript strict; ESNext modules (`"type": "module"`); JSX via `react-jsx`.
- Tailwind classes must resolve against BB's host tokens (`text-success`, `text-warning`, `text-destructive`, `bg-state-hover`, `bg-sidebar`, `border-sidebar-border`, …) — the build compiles plugin CSS referencing host CSS variables. Avoid inventing tokens (there is no `text-info`).
- Native `<button>` takes `title`; the shared `Button` component omits `title` — use `aria-label` for tooltips there.

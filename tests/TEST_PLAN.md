# Spoon test plan

This file is the map from features to tests. Every feature in the app has at least one automated
test. A row marked `BUG-xx` points at a confirmed defect: its test is written as a `todo`. That
means it runs and reports the failure, but it does not fail the suite. When the bug is fixed, the
`todo` test passes. Remove the `todo` marker then so the test guards the fix.

## How to run

| Command | What it runs | Time |
|---|---|---|
| `npm run test:unit` | Main-process and shared logic against real throwaway Git repos (`tests/unit`, `src/**/*.test.ts`) | ~2 min |
| `npm run test:e2e` | Builds the app, then drives the real Electron window with Playwright (`tests/e2e`) | ~15 min |
| `npm test` | Both of the above | ~17 min |
| `npm run test:visual` | Older visual and button-style checks (`scripts/test-*-ui.cjs`) | ~3 min |

To run one file or one test:

```
node --import ./tests/support/register.mjs --test tests/unit/git-refs.test.ts
node --test --test-name-pattern="stash" tests/e2e/refs.test.mjs
```

A failed E2E step writes a screenshot to `output/e2e/fail-<test name>.png`.

### Isolation (safe to run on a dev machine)

- **Unit tests** (`tests/support/register.mjs`):
  - Each test process gets its own temp sandbox.
  - `HOME`, `USERPROFILE` and `GIT_CONFIG_GLOBAL` point at the sandbox, so the real `~/.gitconfig`, `~/.claude`, `~/.codex` and `~/.grok` are never read or written.
  - `electron` is replaced by `tests/support/electron-stub.mjs`, which records shell, clipboard and dialog calls.
- **E2E tests** (`tests/e2e/harness.mjs`):
  - Spoon starts with its own `userData`, home folder and global Git config.
  - Native dialogs, menus, `shell` and the clipboard are patched in the main process. They answer from queues and record what would have left the app.
  - No window is shown, nothing is opened in a browser or editor, and no real AI account is used.
- **AI tests:** they talk to `tests/support/fake-ai.ts`, a local OpenAI-compatible server connected as a custom endpoint.

## Feature inventory and coverage

Legend: U = unit test, E = end-to-end test.

### Repositories (Home)

| Feature | Test |
|---|---|
| List, status metrics, greeting | E `home` |
| Filter box and clear | E `home` |
| Sort menu (persists `repoSort`) | E `home` |
| Status chips (Uncommitted / Behind / To push / Attention) | E `home` |
| Selection with click, Ctrl/Shift, Select all, Clear | E `home` |
| Pin / unpin | E `home` |
| Sidebar sections fold (persist `homeCollapsed`), folded status digest, filter unfolds | E `home` |
| Arrow / Home / End keys move the selection, Shift+arrow extends it | E `home` |
| Workspaces unfold into their repos (persist `homeExpanded`), drag repos onto a workspace, remove a member | E `home` |
| Save selection as a workspace; edit, recolour, delete | E `home`, U `store`, U `shared` |
| Workspaces manager and AI workspace suggestions | E `ai`, U `ai` |
| Open by double-click; close tabs back to Home | E `home` |
| Bulk Refresh / Fetch / Pull / Push with skip rules | E `home` |
| Scan folders (watched roots), rescan | E `home`, U `git-repos` (`scanRepos`) |
| Add a repo, or a folder of repos (warns when there are none) | E `home` |
| New repository (`git init` + README commit) | E `home`, U `git-repos` |
| Clone (progress, custom folder name, error) | E `home`, U `git-repos` |
| Credential prompt: clone / push / fetch from a password-protected remote ask in a Spoon dialog; background fetch never asks | E `home`, U `askpass` |
| Repo row menu: pin, remove, fetch… | E `home` |
| Overview cache (`repo-records.json`) | U `main-services` |
| Activity heat map (day/week/month/year buckets) | U `shared`, U `git-refs` (`activityDays`) |

### Health check

| Feature | Test |
|---|---|
| Detects missing folder, not a repo, `index.lock`, operation in progress, detached HEAD, no remote, unpublished branch, untracked upstream, behind, diverged, gone branches, missing identity, uninitialised submodules, gc, fsck | U `git-repos` |
| Each one-click fix | U `git-repos` |
| Health dialog in the app; `index.lock` fix | E `home` |
| "Set name and email" fix in the app | E `home` |

### Changes view

| Feature | Test |
|---|---|
| Unstaged / staged / untracked / deleted / renamed lists | U `git-changes`, E `changes` |
| Conflicted files | U `git-changes` |
| Stage / unstage files, multi-select, Ctrl+A, stage all | U, E `changes` |
| Hunk stage / unstage / discard | U, E `changes` |
| Discard files (asks for confirmation, Cancel keeps the file) | U, E `changes` |
| Unified / side-by-side diff, ignore whitespace, context lines | U, E `changes` |
| Image / PDF / video previews, 12 MB limit, path safety | U `git-repos`, E `changes` |
| File menu: open in editor, reveal, copy path / patch, blame, history | E `changes`, U `main-services` |
| Commit, Ctrl+Enter, amend, sign-off, no-verify, empty commit error | U, E `changes` |

### History

| Feature | Test |
|---|---|
| Commit list with graph and refs; search by message / hash | U `git-refs`, U `graph`, E `history` |
| Details: Commit / Changes / File Tree; copy SHA | E `history` |
| File tree: file history (follows renames), blame | U, E `history` |
| Layouts: Bottom / Side / Columns | E `history` |
| Commit menu: checkout, cherry-pick, revert, reset mixed/hard, copy SHA | U, E `history` |
| Commit menu: Create tag | E `history` |
| Reflog | U, E `history` |
| Interactive rebase | E `history`, E `no-node` |
| Branch / tag scope ("Commits in …", "Show all") | E `history`, E `refs` |

### Branches, remotes, tags, stash

| Feature | Test |
|---|---|
| New branch (toolbar, sidebar, start point), checkout, rename, delete (force) | U `git-refs`, E `refs` |
| Merge (`--no-ff`, squash) and rebase from the branch menu | U, E `refs` |
| Conflict banner, Resolve dialog, Continue, Abort | U, E `refs` |
| Remotes: add, edit URL, rename, fetch, remove | U, E `refs` |
| Remote branch checkout | E `refs` |
| Tags: create, annotated, delete, sidebar scope | U, E `refs` |
| Stash: save (with untracked), view, apply, pop, drop, partial | U, E `refs` |
| Submodules: list, init, update | U `git-repos` |
| Worktrees, LFS listing | U `git-refs`, U `git-repos` |

### Sync

| Feature | Test |
|---|---|
| Fetch / Pull / Push toolbar buttons with counts | E `refs` |
| Push sets the upstream for new branches; push with no remote errors | E `refs` |
| Pull with rebase, force-with-lease, prune, tags | U `git-refs` |
| Pull with auto-stash (API) | U `git-refs` |

### AI

| Feature | Test |
|---|---|
| Connect: local session import, API keys, custom endpoint (invalid URL rejected), remove | U `ai`, E `ai`, E `app` |
| AI message (fill mode), model picker with live models | U `ai`, E `ai` |
| Analyze → plan → create N commits | U `ai`, E `ai` |
| Split & commit mode | E `ai` |
| AI errors shown to the user; falls back to folder grouping | U `ai`, E `ai` |
| Message cleanup (fences / quotes) | U `ai` |

### App shell and settings

| Feature | Test |
|---|---|
| Appearance: packs, light/dark, SpaceX stays dark, icons, accents | E `app`, U `shared` |
| Git settings: auto fetch, interval, auto update | E `app` |
| Open with: detection (registry PATH, CLI install folders, no bash shims), rescan, default launcher | E `app`, U `main-services` |
| Open with: launching IDEs / CLIs / terminal, errors shown, button icon follows the default | E `open-with`, U `main-services` |
| Help links, rail keyboard navigation | E `app` |
| Tour (Next / Back / keys / Skip, saves `onboarded`) | E `app` |
| About dialog | E `app` |
| Quick Launch (Ctrl+P / Ctrl+K) | E `app` |
| Menu actions: views, settings, theme toggle | E `app` |
| Activity console, confetti | E `app` |
| Tabs: new, close, colour groups, collapse, session restore | E `app`, U `store` |
| Settings storage, migrations, sessions, credentials | U `store` |
| Auto-updater states | U `main-services` |

## Regression suites

| Suite | When | Command |
|---|---|---|
| Smoke (~3 min) | before every commit | `npm run test:unit` |
| Full (~17 min) | before a release / version bump | `npm test` |
| Visual (~3 min) | after styling changes | `npm run test:visual` |
| Targeted | while working on one area | `node --test --test-name-pattern=<area> tests/e2e/<file>.test.mjs` |

**Release gate:** `npm test` exits 0, and no new `todo` was added without a `BUG-xx` entry below.

## Known bugs

None open. When a test exposes a new bug, write the test for the correct behaviour, mark it
`{ todo: 'BUG-xx short reason' }` and add a row here.

| ID | Severity | Where | Problem |
|---|---|---|---|

## Fixed (2026-10-13)

The first run of this suite found 16 bugs. They are fixed, and their tests now guard them.

| ID | Fix |
|---|---|
| BUG-01 | `parseUnmerged` reads the 10th field. Conflicted files keep their path, and the Resolve dialog opens. |
| BUG-02 | The interactive rebase todo is written oldest-first. |
| BUG-03 | The rebase sequence editor runs with Spoon's own runtime (`ELECTRON_RUN_AS_NODE`), so Node.js is no longer needed. |
| BUG-04 | Rebasing a list that reaches the root uses `--root`. An invalid `onto` falls back to it. |
| BUG-05 | IDEs are launched without cmd.exe re-parsing the folder. Terminals and agents get the folder as their working directory. |
| BUG-06 | New `git.checkoutRemote`: reuses the local branch, or creates one with `--track`. |
| BUG-07 | "Create tag…" tags the right-clicked commit. |
| BUG-08 | "Set name and email" uses an in-app form instead of `window.prompt`. |
| BUG-09 | An unreadable `spoon.json` is backed up as `spoon.corrupt-<time>.json`. Saves write a temp file and rename it. |
| BUG-10 | Auto-stash pull only pops a stash it created. |
| BUG-11 | Clone names handle Windows paths and scp-style remotes. |
| BUG-12 | `parseHunks` ignores the trailing empty line. |
| BUG-13 | AI message cleanup only strips quotes that wrap the whole message. |
| BUG-14 | `readConflict` / `writeResolved` reject paths outside the repository. |
| BUG-15 | "Toggle Theme" reads the saved theme. |
| BUG-16 | Clone, Create repository, interactive rebase, Mark resolved, field dialogs, hunk actions and branch double-click show errors instead of failing silently. |
| UX | Discarding a hunk asks for confirmation. |

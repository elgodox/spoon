<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Spoon">
</p>

<h1 align="center">Spoon</h1>

<p align="center">
  A fast Windows Git client with AI commit messages.<br>
  Clone, scan your disks for repos, review diffs, and ship — without leaving the desktop.
</p>

<p align="center">
  <a href="https://github.com/elgodox/spoon/releases/latest"><img src="https://img.shields.io/github/v/release/elgodox/spoon?label=release" alt="Latest release"></a>
  <a href="https://github.com/elgodox/spoon/releases/latest"><img src="https://img.shields.io/github/downloads/elgodox/spoon/total?label=downloads" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%26%2011-0078D6?logo=windows&logoColor=white" alt="Windows 10 and 11">
</p>

<p align="center">
  <a href="https://github.com/elgodox/spoon/releases/latest"><strong>Download Spoon for Windows</strong></a>
</p>

## Why Spoon

Spoon is a native desktop Git client for Windows. It uses the `git` you already have (including Git Credential Manager), so clone, fetch, and push work the same way they do in the terminal.

Layout is familiar: repo tabs, a refs sidebar, a commit graph, a changes view, and a commit box. On top of that it writes commit messages with **Free AI**, **Grok**, **ChatGPT**, **Claude**, or any OpenAI-compatible API (OpenRouter, Groq, Gemini, Ollama, …), and can split a dirty worktree into one local commit per change.

## Install

**Requirements:** Windows 10 or 11 (x64) and [Git for Windows](https://git-scm.com/download/win).

1. Download **Spoon-Setup-1.2.1.exe** from the [latest release](https://github.com/elgodox/spoon/releases/latest).
2. Run the installer. You can pick the folder; it creates Start Menu and desktop shortcuts.
3. If Windows SmartScreen appears, choose **More info → Run anyway**. The installer is not code-signed.

Spoon does not need Node.js to run. Node is only for building from source.

API keys and OAuth tokens stay on this machine (`%APPDATA%\spoon\spoon.json`). They are never sent to a Spoon server.

## Quick start

1. Open **Home** (Repository Manager).
2. **Scan folders** to find every Git repo under one or more directories (Ctrl+click to pick several), or **Clone** / **Add existing** / **Create new**.
3. Open a repo. Use **Changes** to stage files (Ctrl/Shift for multi-select) and write the message. The first launch walks you through Home, sync, and AI.
4. **AI** in Preferences starts on **Free AI** (no account). Add Grok, ChatGPT, Claude, or a site from the catalog (OpenRouter, Groq, Gemini, Ollama, …). You can also paste any OpenAI-compatible base URL.

## Features

**Repositories**
- Tabs for several repos at once
- Scan folders for Git repositories
- Clone, add an existing folder, or init a new repo
- Refresh, fetch, or pull every listed repo in one pass
- Health check with one-click repairs (unsafe folder, stale lock, missing upstream, gc, …)
- Open a submodule in its own tab (initializes it if needed)

**History & refs**
- Commit graph with connected lanes
- Click a branch to pulse its line in the graph
- Local and remote branches, grouped by remote
- Create, rename, and delete branches from the sidebar
- Add, edit, rename, or remove remotes
- Tags, stash, reflog, interactive rebase, cherry-pick, revert, reset

**Changes**
- Stage / unstage files and hunks
- Multi-select in Unstaged and Staged
- Unified or side-by-side diff
- Preview images, GIF, video, audio, and PDF (up to 12 MB)

**AI**
- Fill the commit box, or create a local commit — push is always a separate action
- Analyze uncommitted work and propose one commit per implementation
- **Free AI** works with no account, and is selected automatically when no other provider is connected
- Add OpenRouter, Groq, Gemini, Ollama, LM Studio, and other OpenAI-compatible APIs from the catalog, or paste a custom base URL
- Live model list from the selected provider

**Desktop**
- Light, dark, or match Windows
- Frosted glass on the toolbar and sidebar (intensity in Preferences)
- Drag to resize every panel
- Interactive tour on first launch
- Automatic updates from GitHub Releases

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl+Enter` | Commit |
| `Ctrl+Shift+Enter` | Commit & push |
| `Ctrl+Alt+M` | AI message (fill only) |
| `Ctrl+Alt+Enter` | AI commit (local) |
| `Ctrl+Alt+Shift+Enter` | AI commit & push |
| `Ctrl+Alt+A` | Analyze changes |
| `Ctrl+P` | Quick Launch |
| `Ctrl+,` | Preferences |

## AI setup

In **Preferences → AI**:

| Method | What it does |
| --- | --- |
| **Free AI** | No sign-in. Anonymous Pollinations GPT-OSS (selected when nothing else is connected). If that route fails, add OpenRouter. |
| **Add a site** | OpenRouter (free account at [openrouter.ai](https://openrouter.ai)), Groq, Gemini, Mistral, DeepSeek, Ollama, LM Studio, and more — paste a key if the site needs one |
| **Custom endpoint** | Any OpenAI-compatible `base URL` + optional key + model id |
| **Use local session** | Reuses a login already on the machine (`~/.grok/auth.json`, `~/.codex/auth.json`, `~/.claude/.credentials.json`) |
| **Sign in with Grok** | OAuth PKCE or device code on `auth.x.ai` |
| **API key** | Opens the provider console; you paste the key |

The model dropdown lists every chat model the selected provider can use and refreshes on its own.

In **Changes**:

- **AI message** only fills the box
- **AI commit** creates a local commit
- **Commit & push** is explicit
- **Analyze** groups files into local commits; nothing is pushed

## Build from source

Requires Node.js 20+ and Git for Windows.

```powershell
git clone https://github.com/elgodox/spoon.git
cd spoon
npm install
npm run dev
```

Leave that window open while Spoon is running.

Daily run without Vite:

```powershell
npm start
```

Windows installer:

```powershell
npm run pack
```

Output: `dist/Spoon-Setup-1.2.1.exe`.

## Git operations

Fetch, pull, push, commit, amend, branches, tags, remotes, checkout, merge, rebase (including interactive), cherry-pick, revert, reset, stash, submodules, blame, file history, file tree, reflog, conflicts, LFS listing, worktrees.

Remote authentication uses Git Credential Manager from Git for Windows.

## Contributing

Issues and pull requests are welcome. Keep the change focused, and describe the problem it solves.

## License

MIT. See [LICENSE](LICENSE).

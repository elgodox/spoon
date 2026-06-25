# Spoon

Spoon is a Windows desktop Git client built with Tauri, React, and Rust.

It scans a folder for Git repos, lets you switch between projects fast, and keeps the common workflow in one place:

- project discovery with search and remembered last selection
- branches, remotes, tags, and stashes
- changed files, staging, discard, commit, and push
- diff viewer with image, video, audio, and PDF previews
- embedded PowerShell terminal inside the app

## Requirements

- Windows 10 or 11
- Git in `PATH`
- Node.js 20+
- Rust + Cargo
- WebView2

PowerShell 7 is recommended. Spoon can resolve `pwsh` automatically.

## Development

```powershell
git clone https://github.com/elgodox/spoon.git
cd spoon
npm install
npm run tauri dev
```

## Build

```powershell
npm run build
npm run tauri build
```

The packaged app is generated under `src-tauri/target/release/bundle/`.

## Structure

```text
src/        React UI
src-tauri/  Tauri + Rust backend
```

## License

MIT

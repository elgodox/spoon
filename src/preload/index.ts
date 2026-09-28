import { contextBridge, ipcRenderer } from 'electron'

const api = {
  git: {
    isRepo: (path: string) => ipcRenderer.invoke('git:isRepo', path),
    open: (path: string) => ipcRenderer.invoke('git:open', path),
    close: (path: string) => ipcRenderer.invoke('git:close', path),
    snapshot: (path: string) => ipcRenderer.invoke('git:snapshot', path),
    scan: (roots: string[]) => ipcRenderer.invoke('git:scan', roots),
    status: (path: string) => ipcRenderer.invoke('git:status', path),
    commits: (path: string, max?: number, extra?: string[]) => ipcRenderer.invoke('git:commits', path, max, extra),
    branches: (path: string) => ipcRenderer.invoke('git:branches', path),
    tags: (path: string) => ipcRenderer.invoke('git:tags', path),
    remotes: (path: string) => ipcRenderer.invoke('git:remotes', path),
    stashes: (path: string) => ipcRenderer.invoke('git:stashes', path),
    submodules: (path: string) => ipcRenderer.invoke('git:submodules', path),
    submoduleUpdate: (path: string, subpath?: string) => ipcRenderer.invoke('git:submoduleUpdate', path, subpath),
    diff: (path: string, opts?: object) => ipcRenderer.invoke('git:diff', path, opts),
    stage: (path: string, files: string[]) => ipcRenderer.invoke('git:stage', path, files),
    unstage: (path: string, files: string[]) => ipcRenderer.invoke('git:unstage', path, files),
    stageAll: (path: string) => ipcRenderer.invoke('git:stageAll', path),
    unstageAll: (path: string) => ipcRenderer.invoke('git:unstageAll', path),
    discard: (path: string, files: string[]) => ipcRenderer.invoke('git:discard', path, files),
    applyHunk: (path: string, file: string, hunk: object, mode: string) =>
      ipcRenderer.invoke('git:applyHunk', path, file, hunk, mode),
    commit: (path: string, opts: object) => ipcRenderer.invoke('git:commit', path, opts),
    fetch: (path: string, opts?: object) => ipcRenderer.invoke('git:fetch', path, opts),
    pull: (path: string, opts?: object) => ipcRenderer.invoke('git:pull', path, opts),
    push: (path: string, opts?: object) => ipcRenderer.invoke('git:push', path, opts),
    checkout: (path: string, ref: string, create?: boolean) => ipcRenderer.invoke('git:checkout', path, ref, create),
    createBranch: (path: string, name: string, checkout: boolean, start?: string) =>
      ipcRenderer.invoke('git:createBranch', path, name, checkout, start),
    deleteBranch: (path: string, name: string, force: boolean, remote?: string) =>
      ipcRenderer.invoke('git:deleteBranch', path, name, force, remote),
    renameBranch: (path: string, from: string, to: string) => ipcRenderer.invoke('git:renameBranch', path, from, to),
    merge: (path: string, ref: string, noFf: boolean, squash: boolean) =>
      ipcRenderer.invoke('git:merge', path, ref, noFf, squash),
    rebase: (path: string, ref: string) => ipcRenderer.invoke('git:rebase', path, ref),
    rebaseContinue: (path: string) => ipcRenderer.invoke('git:rebaseContinue', path),
    rebaseAbort: (path: string) => ipcRenderer.invoke('git:rebaseAbort', path),
    interactiveRebase: (path: string, onto: string, todos: object[]) =>
      ipcRenderer.invoke('git:interactiveRebase', path, onto, todos),
    cherryPick: (path: string, hashes: string[]) => ipcRenderer.invoke('git:cherryPick', path, hashes),
    revert: (path: string, hashes: string[]) => ipcRenderer.invoke('git:revert', path, hashes),
    reset: (path: string, hash: string, mode: string) => ipcRenderer.invoke('git:reset', path, hash, mode),
    createTag: (path: string, name: string, message?: string, hash?: string) =>
      ipcRenderer.invoke('git:createTag', path, name, message, hash),
    deleteTag: (path: string, name: string) => ipcRenderer.invoke('git:deleteTag', path, name),
    stash: (path: string, message?: string, files?: string[]) => ipcRenderer.invoke('git:stash', path, message, files),
    stashApply: (path: string, sel: string, pop: boolean) => ipcRenderer.invoke('git:stashApply', path, sel, pop),
    stashDrop: (path: string, sel: string) => ipcRenderer.invoke('git:stashDrop', path, sel),
    addRemote: (path: string, name: string, url: string) => ipcRenderer.invoke('git:addRemote', path, name, url),
    removeRemote: (path: string, name: string) => ipcRenderer.invoke('git:removeRemote', path, name),
    setRemoteUrl: (path: string, name: string, url: string) => ipcRenderer.invoke('git:setRemoteUrl', path, name, url),
    renameRemote: (path: string, from: string, to: string) => ipcRenderer.invoke('git:renameRemote', path, from, to),
    blame: (path: string, file: string, rev?: string) => ipcRenderer.invoke('git:blame', path, file, rev),
    history: (path: string, file: string) => ipcRenderer.invoke('git:history', path, file),
    tree: (path: string, rev?: string) => ipcRenderer.invoke('git:tree', path, rev),
    showFile: (path: string, rev: string, file: string) => ipcRenderer.invoke('git:showFile', path, rev, file),
    preview: (path: string, file: string, opts?: { rev?: string; origPath?: string }) =>
      ipcRenderer.invoke('git:preview', path, file, opts),
    openFile: (path: string, file: string) => ipcRenderer.invoke('git:openFile', path, file),
    reflog: (path: string) => ipcRenderer.invoke('git:reflog', path),
    readConflict: (path: string, file: string) => ipcRenderer.invoke('git:readConflict', path, file),
    writeResolved: (path: string, file: string, content: string) =>
      ipcRenderer.invoke('git:writeResolved', path, file, content),
    abortMerge: (path: string) => ipcRenderer.invoke('git:abortMerge', path),
    continueMerge: (path: string) => ipcRenderer.invoke('git:continueMerge', path),
    identity: (path: string) => ipcRenderer.invoke('git:identity', path),
    stagedPatch: (path: string) => ipcRenderer.invoke('git:stagedPatch', path),
    workingPatch: (path: string) => ipcRenderer.invoke('git:workingPatch', path),
    clone: (opts: object) => ipcRenderer.invoke('git:clone', opts),
    init: (directory: string, initial: boolean) => ipcRenderer.invoke('git:init', directory, initial),
    lfs: (path: string) => ipcRenderer.invoke('git:lfs', path),
    worktrees: (path: string) => ipcRenderer.invoke('git:worktrees', path)
  },
  repo: {
    overview: (paths: string[]) => ipcRenderer.invoke('repo:overview', paths),
    health: (path: string, deep?: boolean) => ipcRenderer.invoke('repo:health', path, deep),
    fix: (path: string, fix: string, input?: { name?: string; email?: string }) =>
      ipcRenderer.invoke('repo:fix', path, fix, input),
    bulk: (action: string, paths: string[]) => ipcRenderer.invoke('repo:bulk', action, paths),
    rescan: () => ipcRenderer.invoke('repo:rescan')
  },
  ai: {
    accounts: () => ipcRenderer.invoke('ai:accounts'),
    local: () => ipcRenderer.invoke('ai:local'),
    importLocal: (provider: string) => ipcRenderer.invoke('ai:import', provider),
    saveApiKey: (provider: string, key: string) => ipcRenderer.invoke('ai:apiKey', provider, key),
    disconnect: (provider: string) => ipcRenderer.invoke('ai:disconnect', provider),
    openConsole: (provider: string) => ipcRenderer.invoke('ai:console', provider),
    grokPkce: () => ipcRenderer.invoke('ai:grokPkce'),
    grokDevice: () => ipcRenderer.invoke('ai:grokDevice'),
    grokPoll: (flow: object) => ipcRenderer.invoke('ai:grokPoll', flow),
    generate: (provider: string, diff: string, extra?: string, model?: string) =>
      ipcRenderer.invoke('ai:generate', provider, diff, extra, model),
    analyze: (repo: string, provider: string, model?: string) =>
      ipcRenderer.invoke('ai:analyze', repo, provider, model),
    models: (provider: string, force?: boolean) => ipcRenderer.invoke('ai:models', provider, force),
    addEndpoint: (endpoint: object, apiKey?: string) => ipcRenderer.invoke('ai:addEndpoint', endpoint, apiKey),
    removeEndpoint: (id: string) => ipcRenderer.invoke('ai:removeEndpoint', id)
  },
  app: {
    settings: () => ipcRenderer.invoke('app:settings'),
    patchSettings: (patch: object) => ipcRenderer.invoke('app:patchSettings', patch),
    recent: () => ipcRenderer.invoke('app:recent'),
    removeRecent: (path: string) => ipcRenderer.invoke('app:removeRecent', path),
    activity: () => ipcRenderer.invoke('app:activity'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    showItem: (path: string) => ipcRenderer.invoke('app:showItem', path),
    openPath: (path: string) => ipcRenderer.invoke('app:openPath', path),
    copy: (text: string) => ipcRenderer.invoke('app:copy', text),
    pickDirectory: () => ipcRenderer.invoke('app:pickDirectory'),
    pickDirectories: () => ipcRenderer.invoke('app:pickDirectories'),
    pickRepo: () => ipcRenderer.invoke('app:pickRepo'),
    addRepos: (repos: { path: string; name: string }[]) => ipcRenderer.invoke('app:addRepos', repos),
    confirm: (message: string, detail?: string) => ipcRenderer.invoke('app:confirm', message, detail),
    error: (message: string) => ipcRenderer.invoke('app:error', message),
    popup: (items: object[]) => ipcRenderer.invoke('app:popup', items),
    chrome: () => ipcRenderer.invoke('app:chrome'),
    version: () => ipcRenderer.invoke('app:version'),
    about: () => ipcRenderer.invoke('app:about'),
    openIn: (path: string, target: 'editor' | 'terminal' | 'explorer') => ipcRenderer.invoke('app:openIn', path, target),
    update: () => ipcRenderer.invoke('app:update'),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
    on: (channel: string, fn: (...args: unknown[]) => void) => {
      const listener = (_e: unknown, ...args: unknown[]) => fn(...args)
      ipcRenderer.on(channel, listener)
      return () => {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('spoon', api)

export type SpoonAPI = typeof api

import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

let state: UpdateState = { status: 'idle' }
let notify: (s: UpdateState) => void = () => undefined
let timer: NodeJS.Timeout | null = null
let wired = false

function set(next: UpdateState): void {
  state = next
  notify(state)
}

function notesText(notes: unknown): string | undefined {
  if (!notes) return undefined
  const raw = Array.isArray(notes) ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n') : String(notes)
  return raw.replace(/<[^>]+>/g, '').trim() || undefined
}

function wire(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: 'elgodox', repo: 'spoon' })
  } catch {
    /* app-update.yml from the installer is enough */
  }
  autoUpdater.on('checking-for-update', () => set({ ...state, status: 'checking', error: undefined }))
  autoUpdater.on('update-not-available', () => set({ status: 'none' }))
  autoUpdater.on('update-available', (info) =>
    set({ status: 'available', version: info.version, notes: notesText(info.releaseNotes) })
  )
  autoUpdater.on('download-progress', (p) => set({ ...state, status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) =>
    set({ status: 'ready', version: info.version, notes: notesText(info.releaseNotes) ?? state.notes, percent: 100 })
  )
  autoUpdater.on('error', (err) => {
    const message = err?.message?.split('\n')[0] ?? String(err)
    if (isQuietFeedMiss(message) && state.status !== 'downloading' && state.status !== 'ready') {
      set({ status: 'none' })
      return
    }
    set({ ...state, status: 'error', error: message })
  })
}

/** GitHub latest.yml 404 / missing updater assets is "no update", not a failed install. */
function isQuietFeedMiss(message: string): boolean {
  const m = message.toLowerCase()
  if (m.includes('cannot find latest.yml') || m.includes('cannot find latest-mac.yml') || m.includes('cannot find latest-linux.yml')) {
    return true
  }
  if (/latest(\.yml|-mac\.yml|-linux\.yml)/.test(m) && (m.includes('404') || m.includes('not found') || m.includes('cannot find'))) {
    return true
  }
  if (m.includes('unable to find latest version on github')) return true
  if (m.includes('httperror: 404') && m.includes('latest.yml')) return true
  return false
}

export function initUpdater(onChange: (s: UpdateState) => void, enabled: boolean): void {
  notify = onChange
  if (!app.isPackaged) {
    set({ status: 'disabled', error: 'Updates only run in the installed app.' })
    return
  }
  wire()
  schedule(enabled)
}

export function schedule(enabled: boolean): void {
  if (timer) clearInterval(timer)
  timer = null
  if (!app.isPackaged) return
  if (!enabled) {
    set({ status: 'disabled' })
    return
  }
  if (state.status === 'disabled') set({ status: 'idle' })
  setTimeout(() => void check(), 8_000)
  timer = setInterval(() => void check(), 4 * 60 * 60 * 1000)
}

export async function check(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  wire()
  if (state.status === 'downloading' || state.status === 'ready') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err)
    if (isQuietFeedMiss(message)) {
      set({ status: 'none' })
    } else {
      set({ status: 'error', error: message })
    }
  }
  return state
}

export function install(): void {
  if (state.status !== 'ready') return
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

export function current(): UpdateState {
  return state
}

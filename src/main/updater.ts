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
  autoUpdater.on('error', (err) =>
    set({ ...state, status: 'error', error: err?.message?.split('\n')[0] ?? String(err) })
  )
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
    set({ status: 'error', error: err instanceof Error ? err.message.split('\n')[0] : String(err) })
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

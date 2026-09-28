import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AboutInfo, UpdateState } from '../../shared/types'
import { IcoClose, IcoHelp, IcoRefresh } from './icons'

const NOTES: Record<string, string[]> = {
  '1.2.1': [
    'About Spoon from the toolbar mark, with version notes and updates.',
    'Commit bar stays at the bottom, with icons and a rounded model menu.',
    'Clearer image and SVG diffs, including side-by-side previews.'
  ],
  '1.2.0': [
    'Health checks, bulk fetch/pull/push, and folder scan.',
    'Automatic updates from GitHub Releases.',
    'Refreshed Home screen and repository list.'
  ],
  '1.1.0': [
    'Free AI writes commit messages with no account.',
    'Add OpenRouter, Groq, Gemini, Ollama, and other OpenAI-compatible APIs.',
    'Custom endpoint for any compatible base URL.'
  ],
  '1.0.0': [
    'Repository tabs, folder scan, clone, add, and init.',
    'Connected commit graph with local and remote branches.',
    'AI commit messages with Grok, ChatGPT, or Claude.'
  ]
}

function notesFor(version: string): string[] {
  if (NOTES[version]) return NOTES[version]
  const known = Object.keys(NOTES).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  return known[0] ? NOTES[known[0]] : []
}

function incomingNotes(raw?: string): string[] {
  if (!raw) return []
  return raw
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*#]+\s*/, '').trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line) && !line.startsWith('|') && !line.startsWith('http'))
    .slice(0, 6)
}

function SpoonBanner() {
  const raw = useId().replace(/:/g, '')
  const bg = `${raw}-bg`
  const metal = `${raw}-metal`
  return (
    <svg className="about-hero-art" viewBox="0 0 720 220" aria-hidden="true">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#5B21B6" />
        </linearGradient>
        <linearGradient id={metal} x1="0.15" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EDE9FE" />
        </linearGradient>
      </defs>
      <rect width="720" height="220" fill={`url(#${bg})`} />
      <circle cx="86" cy="-18" r="120" fill="#fff" opacity="0.07" />
      <circle cx="660" cy="230" r="130" fill="#2e1064" opacity="0.22" />
      <g transform="translate(360 118) rotate(-38) scale(0.3) translate(-512 -400)">
        <rect x="492" y="448" width="40" height="400" rx="20" fill={`url(#${metal})`} />
        <ellipse cx="512" cy="292" rx="176" ry="218" fill={`url(#${metal})`} />
        <path fill="#FFFFFF" d="M400 250 C445 165 560 155 612 228 C540 200 460 218 400 250 Z" />
        <path fill="#6D28D9" opacity="0.14" d="M430 360 C470 430 560 430 600 355 C575 400 500 412 430 360 Z" />
      </g>
    </svg>
  )
}

function updateAction(state: UpdateState, version: string) {
  switch (state.status) {
    case 'checking':
      return { label: 'Checking…', detail: 'Looking for a newer Spoon.', kind: 'busy' as const }
    case 'available':
      return {
        label: 'Downloading…',
        detail: `Spoon ${state.version} is available.`,
        kind: 'busy' as const
      }
    case 'downloading':
      return {
        label: `Downloading ${state.percent ?? 0}%`,
        detail: `Spoon ${state.version} is on its way.`,
        kind: 'busy' as const
      }
    case 'ready':
      return {
        label: 'Restart and install',
        detail: `Spoon ${state.version} is ready.`,
        kind: 'install' as const
      }
    case 'none':
      return { label: 'Check for updates', detail: `Spoon ${version || 'this build'} is up to date.`, kind: 'check' as const }
    case 'error':
      return { label: 'Try again', detail: state.error ?? 'Could not check for updates.', kind: 'check' as const }
    case 'disabled':
      return { label: 'Check for updates', detail: 'Updates run in the installed app.', kind: 'check' as const }
    default:
      return { label: 'Check for updates', detail: 'Get the latest Spoon from GitHub Releases.', kind: 'check' as const }
  }
}

export function AboutDialog({ onClose, onHelp }: { onClose: () => void; onHelp: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [info, setInfo] = useState<AboutInfo | null>(null)
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' })
  const version = info?.version ?? ''
  const currentNotes = notesFor(version)
  const nextNotes = useMemo(() => incomingNotes(update.notes), [update.notes])
  const action = updateAction(update, version)
  const busy = action.kind === 'busy'

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus()
    void window.spoon.app.about().then((data) => setInfo(data as AboutInfo))
    void window.spoon.app.update().then((s) => setUpdate(s as UpdateState))
    const off = window.spoon.app.on('update', (s) => setUpdate(s as UpdateState))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [])

  async function onUpdate() {
    if (action.kind === 'install') {
      window.spoon.app.installUpdate()
      return
    }
    setUpdate((await window.spoon.app.checkUpdate()) as UpdateState)
  }

  return (
    <div className="dialog-back about-back" onMouseDown={onClose}>
      <div
        ref={panel}
        className="dialog about"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="about-hero">
          <SpoonBanner />
          <button type="button" className="about-close" aria-label="Close" onClick={onClose}>
            <IcoClose />
          </button>
        </div>
        <div className="about-body">
          <header className="about-brand">
            <p className="about-kicker">Git client for Windows</p>
            <h2 id="about-title">Spoon</h2>
            <p className="about-ver">{version ? `Version ${version}` : 'Loading version…'}</p>
          </header>
          <div className="about-actions">
            <button
              type="button"
              className="primary ico-text"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void onUpdate()}
            >
              <IcoRefresh />
              <span>{action.label}</span>
            </button>
            <button type="button" className="ghost ico-text" onClick={onHelp}>
              <IcoHelp />
              <span>Help</span>
            </button>
          </div>
          <p className="about-status" role="status">
            {action.detail}
          </p>
          {update.status === 'ready' && nextNotes.length > 0 ? (
            <section className="about-block">
              <h3>What's new</h3>
              <ul>
                {nextNotes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : currentNotes.length > 0 ? (
            <section className="about-block">
              <h3>What's new</h3>
              <ul>
                {currentNotes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="about-block">
            <h3>Developer</h3>
            <dl className="about-meta">
              <div>
                <dt>Author</dt>
                <dd>Alan (elgodox)</dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>MIT · Copyright 2026</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  <button
                    type="button"
                    className="about-link"
                    onClick={() => void window.spoon.app.openExternal('https://github.com/elgodox/spoon')}
                  >
                    github.com/elgodox/spoon
                  </button>
                </dd>
              </div>
              {info && (
                <div>
                  <dt>Runtime</dt>
                  <dd>
                    Electron {info.electron} · Chromium {info.chrome.split('.').slice(0, 2).join('.')}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

export type TourStep = {
  id: string
  title: string
  body: string
  target?: string
}

const STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'This is Spoon',
    body: 'A Git client for Windows. Repositories live in tabs. Changes, history, and AI commit messages stay on this machine.'
  },
  {
    id: 'home',
    title: 'Home is the repository manager',
    body: 'Add repositories in the first group, then sync them in bulk. Pin the ones you use every day.',
    target: '[data-tour="home"]'
  },
  {
    id: 'sync',
    title: 'Fetch, pull, push',
    body: 'These talk to the remotes of the repo in the current tab. From Home you can also fetch or pull every listed repository at once.',
    target: '[data-tour="sync"]'
  },
  {
    id: 'workspace',
    title: 'Changes and history',
    body: 'Open a repo, then use Changes to stage files and History to walk the graph. Click a branch to pulse its line.',
    target: '[data-tour="tabs"]'
  },
  {
    id: 'settings',
    title: 'Settings is one menu',
    body: 'Appearance, Git, AI, and Help live in Settings. The left menu switches sections and can collapse. Theme is light or dark.',
    target: '[data-tour="prefs"]'
  }
]

export function Tour({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const last = step === STEPS.length - 1
  const rect = useSpotlight(open ? current?.target : undefined)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') setStep((s) => Math.min(STEPS.length - 1, s + 1))
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !current) return null

  const cardStyle = cardPosition(rect)

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {!rect && <div className="tour-dim" onClick={onClose} />}
      {rect && <div className="tour-spot" style={rect} />}
      {rect && <div className="tour-dim" onClick={onClose} style={{ background: 'transparent' }} />}
      <div className="tour-card" style={cardStyle}>
        <div className="tour-kicker">
          {step + 1} / {STEPS.length}
        </div>
        <h2 id="tour-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="tour-foot">
          <button className="ghost" onClick={onClose}>
            Skip
          </button>
          {step > 0 && (
            <button className="ghost" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          <button
            className="primary"
            onClick={() => {
              if (last) onClose()
              else setStep((s) => s + 1)
            }}
          >
            {last ? 'Start using Spoon' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

function useSpotlight(selector?: string) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  useEffect(() => {
    if (!selector) {
      setBox(null)
      return
    }
    const measure = () => {
      const el = document.querySelector(selector)
      if (!el) {
        setBox(null)
        return
      }
      const r = el.getBoundingClientRect()
      setBox({
        top: Math.max(8, r.top - 8),
        left: Math.max(8, r.left - 8),
        width: r.width + 16,
        height: r.height + 16
      })
    }
    measure()
    window.addEventListener('resize', measure)
    const t = window.setTimeout(measure, 80)
    return () => {
      window.removeEventListener('resize', measure)
      window.clearTimeout(t)
    }
  }, [selector])

  return box
}

function cardPosition(rect: { top: number; left: number; width: number; height: number } | null) {
  if (!rect) return { top: '22%', left: '50%', transform: 'translateX(-50%)' }
  const below = rect.top + rect.height + 16
  const top = below + 220 > window.innerHeight ? Math.max(24, rect.top - 230) : below
  const left = Math.min(Math.max(24, rect.left), window.innerWidth - 420)
  return { top, left, transform: 'none' }
}

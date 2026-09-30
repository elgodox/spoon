import { Button } from './Button'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ContextAction { label?: string; icon?: ReactNode; run?: () => void; disabled?: boolean; danger?: boolean }
export interface ContextState { x: number; y: number; title: string; items: ContextAction[] }
export function ContextMenu({ menu, onClose }: { menu: ContextState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const box = node.getBoundingClientRect()
    node.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - box.width - 8))}px`
    node.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - box.height - 8))}px`
    node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const close = (e: PointerEvent) => { if (!node.contains(e.target as Node)) onClose() }
    const blur = () => onClose()
    document.addEventListener('pointerdown', close)
    window.addEventListener('blur', blur)
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('blur', blur); if (document.activeElement === document.body || node.contains(document.activeElement)) previous?.focus() }
  }, [menu, onClose])
  return createPortal(<div ref={ref} className="change-context-menu" role="menu" aria-label="File actions" onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }}><div className="context-file" title={menu.title}>{menu.title}</div>{menu.items.map((item, i) => item.label ? <Button variant="menu" key={i} role="menuitem" disabled={item.disabled} className={item.danger ? 'danger' : ''} onClick={() => { onClose(); item.run?.() }}><span className="context-icon">{item.icon}</span>{item.label}</Button> : <div key={i} role="separator" className="context-separator" />)}</div>, document.body)
}

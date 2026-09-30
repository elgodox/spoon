import type { ComponentProps } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon' | 'toolbar' | 'menu' | 'navigation' | 'tab' | 'segment' | 'card' | 'color' | 'filter' | 'select' | 'link' | 'tab-hit'

// Keep existing layout classes while giving every button one shared visual contract.
export function buttonVariant(className = ''): ButtonVariant {
  const classes = new Set(className.split(/\s+/))
  if (classes.has('primary')) return 'primary'
  if (classes.has('tb-btn') || (classes.has('ico-act') && !classes.has('bare'))) return 'toolbar'
  if (['x', 'icon-x', 'about-close', 'tab-add', 'sec-add', 'bare'].some((name) => classes.has(name))) return 'icon'
  if (classes.has('tab-hit') || classes.has('tab-group-label')) return 'tab-hit'
  if (classes.has('tab-menu-item') || classes.has('menu-select-opt')) return 'menu'
  if (classes.has('rail-item') || classes.has('rail-toggle')) return 'navigation'
  if (classes.has('theme-pack-card')) return 'card'
  if (classes.has('accent-swatch') || classes.has('swatch')) return 'color'
  if (classes.has('stat-pill')) return 'filter'
  if (classes.has('menu-select-btn')) return 'select'
  if (classes.has('linkish') || classes.has('about-link')) return 'link'
  return classes.has('danger') ? 'danger' : 'secondary'
}

type ButtonProps = ComponentProps<'button'> & { variant?: ButtonVariant; static?: boolean }

export function Button({ className = '', variant, type = 'button', static: staticPress = false, ...props }: ButtonProps) {
  return <button {...props} type={type} className={`spoon-button ${className}`.trim()} data-button-variant={variant ?? buttonVariant(className)} data-static={staticPress || undefined} />
}

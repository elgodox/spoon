import type { ReactNode, SVGProps } from 'react'

function S(props: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  const { children, ...rest } = props
  return (
    <svg viewBox="0 0 24 24" className="icon-svg ico" {...rest}>
      {children}
    </svg>
  )
}

export const IcoFetch = () => (
  <S>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </S>
)
export const IcoPull = () => (
  <S>
    <path d="M12 3v12" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 21h16" />
  </S>
)
export const IcoPush = () => (
  <S>
    <path d="M12 21V9" />
    <path d="M8 13l4-4 4 4" />
    <path d="M4 3h16" />
  </S>
)
export const IcoStash = () => (
  <S>
    <path d="M4 8h16l-2 12H6L4 8z" />
    <path d="M8 8V6a4 4 0 0 1 8 0v2" />
  </S>
)
export const IcoLaunch = () => (
  <S>
    <circle cx="10.5" cy="10.5" r="6.2" />
    <path d="M15.2 15.2L21 21" strokeWidth="2" />
  </S>
)
export const IcoBranch = () => (
  <S>
    <circle cx="6" cy="6" r="2.2" />
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="12" r="2.2" />
    <path d="M6 8v8M8 6h4a6 6 0 0 1 6 6" />
  </S>
)
export const IcoOpen = () => (
  <S>
    <path d="M4 12V6h10l2 3h4v11H4z" />
  </S>
)
export const IcoConsole = () => (
  <S>
    <rect x="3" y="5" width="18" height="14" />
    <path d="M7 10l3 2-3 2M12 14h5" />
  </S>
)
export const IcoTheme = () => (
  <S>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M5 19l1.5-1.5" />
  </S>
)
export const IcoHome = () => (
  <S>
    <path d="M4 11l8-7 8 7v9H4z" />
  </S>
)
export const IcoAi = () => (
  <S>
    <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z" />
  </S>
)
export const IcoTag = () => (
  <S>
    <path d="M3 12l9-9h7v7l-9 9z" />
    <circle cx="16" cy="8" r="1.2" />
  </S>
)
export const IcoRemote = () => (
  <S>
    <circle cx="12" cy="12" r="3" />
    <path d="M5 12a7 7 0 0 1 14 0M2 12a10 10 0 0 1 20 0" />
  </S>
)
export const IcoChanges = () => (
  <S>
    <path d="M5 5h10v14H5zM15 8h4v11H9" />
  </S>
)
export const IcoSpoon = () => (
  <S>
    <ellipse cx="8.2" cy="8.2" rx="4.6" ry="5.8" />
    <path d="M10.6 12.2c2.6 2.7 6.4 6.8 8.9 9.1" strokeWidth="2.15" />
    <ellipse cx="7.3" cy="8.5" rx="2.2" ry="3.3" />
  </S>
)
export const IcoHealth = () => (
  <S>
    <path d="M12 21s-7-4.4-7-10a4.5 4.5 0 0 1 7-3.5A4.5 4.5 0 0 1 19 11c0 5.6-7 10-7 10z" />
  </S>
)
export const IcoRefresh = () => (
  <S>
    <path d="M20 12a8 8 0 1 1-2.2-5.5" />
    <path d="M20 4v6h-6" />
  </S>
)
export const IcoHelp = () => (
  <S>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.2a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.1 1-1.1 1.8v.4" />
    <path d="M12 17.2h.01" />
  </S>
)

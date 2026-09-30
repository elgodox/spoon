import type { ReactNode, SVGProps } from 'react'

function S(props: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  const { children, ...rest } = props
  return (
    <svg viewBox="0 0 24 24" className="icon-svg ico" aria-hidden="true" {...rest}>
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
export const IcoWorkspaces = () => (
  <S>
    <rect x="3" y="8" width="12" height="11" rx="1.6" />
    <path d="M8 8V5.6A1.6 1.6 0 0 1 9.6 4H19a1.6 1.6 0 0 1 1.6 1.6V14a1.6 1.6 0 0 1-1.6 1.6h-4" />
  </S>
)
export const IcoSave = () => (
  <S>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h7V4" />
    <path d="M8 20v-6h8v6" />
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
    <path d="M10 4l2.1 6.1L18 12l-5.9 2L10 20l-2-6-6-2 6-1.9z" fill="currentColor" stroke="none" />
    <path d="M19 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" fill="currentColor" stroke="none" />
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
    <ellipse cx="8.6" cy="8.1" rx="5" ry="6" transform="rotate(-35 8.6 8.1)" fill="currentColor" stroke="none" />
    <path d="M11.7 12.3L20 21" strokeWidth="2.8" />
    <path d="M6 6c-1.5 2-.8 4 .5 5" stroke="var(--accent)" strokeWidth="1.3" opacity=".45" />
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
export const IcoSettings = () => (
  <S>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </S>
)
export const IcoClose = () => (
  <S>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </S>
)
export const IcoCheck = () => (
  <S>
    <path d="M5 12.5l4.2 4.2L19 7.5" strokeWidth="2" />
  </S>
)
export const IcoChevron = () => (
  <S>
    <path d="M14.5 6l-6 6 6 6" />
  </S>
)
export const IcoClone = () => (
  <S>
    <path d="M8 7H5v13h10v-3" />
    <path d="M9 4h10v13H9z" />
  </S>
)
export const IcoAddRepo = () => (
  <S>
    <path d="M3 7h6l2 2h10v11H3z" />
    <path d="M12 13v5M9.5 15.5h5" />
  </S>
)
export const IcoCreate = () => (
  <S>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <path d="M12 8v8M8 12h8" />
  </S>
)
export const IcoScan = () => (
  <S>
    <path d="M3 8h6l2 2h10v10H3z" />
    <circle cx="14" cy="15" r="2.6" />
    <path d="M16 17l2.4 2.4" />
  </S>
)
export const IcoPin = ({ filled = false }: { filled?: boolean }) => (
  <S>
    <path
      d="M9 3.5h6v6c0 1.15.45 1.9 1.25 2.6L18 14H6l1.75-1.9C8.55 11.4 9 10.65 9 9.5z"
      fill={filled ? 'currentColor' : 'none'}
    />
    <path d="M12 14v7" />
  </S>
)
export const IcoUnpin = () => (
  <S>
    <path d="M9 3.5h6v6c0 1.15.45 1.9 1.25 2.6L18 14H6l1.75-1.9C8.55 11.4 9 10.65 9 9.5z" />
    <path d="M12 14v7" />
    <path d="M5 5l14 14" />
  </S>
)
export const IcoTrash = () => (
  <S>
    <path d="M5 7h14" />
    <path d="M9 7V5h6v2" />
    <path d="M7 7l1 13h8l1-13" />
    <path d="M10 11v5M14 11v5" />
  </S>
)
export const IcoCode = () => (
  <S>
    <path d="M8 8L4 12l4 4" />
    <path d="M16 8l4 4-4 4" />
  </S>
)
export const IcoShield = () => (
  <S>
    <path d="M12 3.2l8 3.2v6.2c0 4.8-3.3 8.1-8 9.6-4.7-1.5-8-4.8-8-9.6V6.4z" />
    <path d="M9 12.2l2.1 2.1 4.2-4.4" />
  </S>
)
export const IcoDeep = () => (
  <S>
    <circle cx="11" cy="11" r="6.2" />
    <path d="M15.5 15.5L21 21" />
    <path d="M11 8.4v3.1l2 1.2" />
  </S>
)
export const IcoWrench = () => (
  <S>
    <path d="M14.5 6.5a4 4 0 0 0-5.6 5.6L4 16.9 7.1 20l5-4.9a4 4 0 0 0 5.6-5.6L15.5 12 12 8.5z" />
  </S>
)

import type { ReactNode, SVGProps } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronLeft,
  CircleHelp,
  CloudDownload,
  Code,
  Copy,
  FileDiff,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  GitBranch,
  Globe,
  HeartPulse,
  House,
  LayoutGrid,
  Pin,
  PinOff,
  RotateCw,
  Save,
  ScanSearch,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePlus,
  SquareTerminal,
  SunMoon,
  Tag,
  Trash2,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'

// One stroke family for the whole app: Lucide outlines, sized and weighted by `.icon-svg`.
const lucide = (Icon: LucideIcon) => {
  const Ico = () => <Icon className="icon-svg ico" aria-hidden="true" />
  Ico.displayName = `Ico(${Icon.displayName ?? 'Lucide'})`
  return Ico
}

function S(props: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  const { children, ...rest } = props
  return (
    <svg viewBox="0 0 24 24" className="icon-svg ico" aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

export const IcoFetch = lucide(CloudDownload)
export const IcoPull = lucide(ArrowDownToLine)
export const IcoPush = lucide(ArrowUpFromLine)
export const IcoStash = lucide(Archive)
export const IcoLaunch = lucide(Search)
export const IcoWorkspaces = lucide(LayoutGrid)
export const IcoSave = lucide(Save)
export const IcoBranch = lucide(GitBranch)
export const IcoOpen = lucide(FolderOpen)
export const IcoFolder = lucide(Folder)
export const IcoConsole = lucide(SquareTerminal)
export const IcoTheme = lucide(SunMoon)
export const IcoHome = lucide(House)
export const IcoAi = lucide(Sparkles)
export const IcoTag = lucide(Tag)
export const IcoRemote = lucide(Globe)
export const IcoChanges = lucide(FileDiff)
export const IcoHealth = lucide(HeartPulse)
export const IcoRefresh = lucide(RotateCw)
export const IcoHelp = lucide(CircleHelp)
export const IcoSettings = lucide(Settings)
export const IcoClose = lucide(X)
export const IcoCheck = lucide(Check)
export const IcoChevron = lucide(ChevronLeft)
export const IcoClone = lucide(Copy)
export const IcoAddRepo = lucide(FolderPlus)
export const IcoCreate = lucide(SquarePlus)
export const IcoScan = lucide(FolderSearch)
export const IcoUnpin = lucide(PinOff)
export const IcoTrash = lucide(Trash2)
export const IcoCode = lucide(Code)
export const IcoShield = lucide(ShieldCheck)
export const IcoDeep = lucide(ScanSearch)
export const IcoWrench = lucide(Wrench)
export const IcoPin = ({ filled = false }: { filled?: boolean }) => (
  <Pin className="icon-svg ico" aria-hidden="true" style={filled ? { fill: 'currentColor' } : undefined} />
)

/** Brand mark: the app icon's spoon-as-commit-graph (resources/spoon.svg), with solid commit dots that stay legible at toolbar size. */
export const IcoSpoon = () => (
  <S>
    <g transform="translate(12 12) scale(.028) translate(-522 -496) rotate(-45 512 512)" fill="none" stroke="currentColor" strokeLinecap="round">
      <path d="M512 560 C512 660 660 640 660 740" strokeWidth="60" />
      <circle cx="660" cy="764" r="70" fill="currentColor" stroke="none" />
      <ellipse cx="512" cy="288" rx="138" ry="176" fill="currentColor" stroke="none" />
      <path d="M512 440 V800" strokeWidth="68" />
      <circle cx="512" cy="830" r="78" fill="currentColor" stroke="none" />
    </g>
  </S>
)

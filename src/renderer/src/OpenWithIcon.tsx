import { useEffect, useState } from 'react'
import type { LauncherIcon } from '../../shared/launchers'
import { IcoAi, IcoCode, IcoConsole, IcoOpen } from './icons'

/**
 * Icon for the "Open with" button: the default launcher's own program icon when Windows has one,
 * else an icon for its kind (IDE, agent, CLI, terminal), else the generic Open icon.
 */
export function OpenWithIcon({ refreshKey }: { refreshKey?: string }) {
  const [info, setInfo] = useState<LauncherIcon | null>(null)
  useEffect(() => {
    let alive = true
    void window.spoon.app
      .launcherIcon()
      .then((next: LauncherIcon) => alive && setInfo(next))
      .catch(() => alive && setInfo(null))
    return () => {
      alive = false
    }
  }, [refreshKey])
  if (info?.icon) {
    return <img className="open-with-icon" data-icon="program" src={info.icon} alt="" width={16} height={16} draggable={false} style={{ flexShrink: 0 }} />
  }
  const [source, Icon] =
    info?.kind === 'ide' ? (['ide', IcoCode] as const)
    : info?.kind === 'agent' ? (['agent', IcoAi] as const)
    : info?.kind === 'cli' || info?.mode === 'terminal' ? (['cli', IcoConsole] as const)
    : (['default', IcoOpen] as const)
  return (
    <span className="open-with-icon" data-icon={source} style={{ display: 'contents' }}>
      <Icon />
    </span>
  )
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Settings } from '../../shared/types'
import { avatarColor, initials } from './lib'

const ProfileContext = createContext<Pick<Settings, 'avatarOverrides' | 'avatarRevision'>>({})
const hashes = new Map<string, Promise<string>>()
export const profileKey = (email: string) => email.trim().toLowerCase()
export function AvatarProvider({ settings, children }: { settings: Settings | null; children: ReactNode }) {
  return <ProfileContext.Provider value={{ avatarOverrides: settings?.avatarOverrides, avatarRevision: settings?.avatarRevision }}>{children}</ProfileContext.Provider>
}
export function Avatar({ email, name, big = false }: { email: string; name: string; big?: boolean }) {
  const profile = useContext(ProfileContext)
  const key = profileKey(email)
  const override = profile.avatarOverrides?.[key]
  const [remote, setRemote] = useState({ key: '', url: '' })
  const [failed, setFailed] = useState('')
  useEffect(() => {
    let alive = true
    if (!key || override) return
    let hash = hashes.get(key)
    if (!hash) {
      hash = crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)).then((bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join(''))
      hashes.set(key, hash)
    }
    void hash.then((value) => { if (alive) setRemote({ key, url: `https://gravatar.com/avatar/${value}?s=128&d=404&v=${profile.avatarRevision ?? 0}` }) }).catch(() => {})
    return () => { alive = false }
  }, [key, override, profile.avatarRevision])
  const source = override || (remote.key === key ? remote.url : '')
  return <span className={`avatar photo${big ? ' big' : ''}`} style={{ background: avatarColor(key) }} title={`${name}${email ? ` <${email}>` : ''}`}>
    {source && failed !== source ? <img src={source} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(source)} /> : initials(name || email || '?')}
  </span>
}

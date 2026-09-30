import { Button } from './Button'
import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../shared/types'
import type { LauncherInfo } from '../../shared/launchers'
import { Avatar, profileKey } from './Avatar'
import { IcoAi, IcoOpen, IcoRefresh } from './icons'

export function ProfileSettings({ settings, repo, onPersist }: { settings: Settings | null; repo?: string; onPersist: (patch: Partial<Settings>) => Promise<unknown> }) {
  const [identity, setIdentity] = useState({ name: '', email: '' })
  const [email, setEmail] = useState(settings?.profileEmail ?? '')
  const [agents, setAgents] = useState<LauncherInfo[]>([])
  const [agent, setAgent] = useState('')
  const [description, setDescription] = useState('An astronaut with violet and blue lighting, a friendly illustrated style')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const generating = useRef(false)
  useEffect(() => {
    mounted.current = true
    void window.spoon.profile.identity(repo).then((value) => { if (mounted.current) { setIdentity(value); setEmail((current) => current || value.email) } }).catch(() => {})
    void window.spoon.profile.generators().then((value) => { if (mounted.current) { setAgents(value); setAgent(value[0]?.id ?? '') } }).catch(() => {})
    return () => { mounted.current = false; if (generating.current) void window.spoon.profile.cancel() }
  }, [repo])
  async function task(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (reason) { if (mounted.current) setError((reason as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')) }
    finally { generating.current = false; if (mounted.current) setBusy(false) }
  }
  const key = profileKey(email)
  const local = settings?.avatarOverrides?.[key]
  async function apply() {
    if (!preview || !key) return
    await onPersist({ profileEmail: email.trim(), avatarOverrides: { ...settings?.avatarOverrides, [key]: preview } })
    setPreview(''); setNotice('Photo applied to this email in Spoon.')
  }
  return <section className="prefs-pane profile-settings" role="tabpanel" id="prefs-panel-profile" aria-labelledby="prefs-tab-profile">
    <h3>Profile photo</h3>
    <p className="hint">History uses the Gravatar photo associated with each author and committer email. A local photo takes priority in Spoon.</p>
    <div className="profile-card"><Avatar email={email} name={identity.name || email} big /><div><strong>{identity.name || 'Your profile'}</strong><span className="hint">{local ? 'Local photo · Spoon' : 'Global photo · Gravatar'}</span></div></div>
    <label htmlFor="profile-email">Commit email</label><input id="profile-email" type="email" value={email} disabled={busy} onChange={(e) => { setEmail(e.target.value); setPreview('') }} onBlur={() => void onPersist({ profileEmail: email.trim() })} />
    <p className="hint">Use the email saved in your commits. This does not change your Git identity.</p>
    <div className="profile-actions">
      <Button className="ghost" disabled={busy || !key} onClick={() => void task(async () => { const image = await window.spoon.profile.pick(); if (image && mounted.current) setPreview(image) })}><IcoOpen /> Choose photo</Button>
      <Button className="ghost" disabled={busy} onClick={() => void window.spoon.app.openExternal('https://gravatar.com/profile/avatars')}>Edit Gravatar ↗</Button>
      <Button className="ghost" disabled={busy} onClick={() => void task(async () => { await onPersist({ avatarRevision: Date.now() }); setNotice('Gravatar refreshed.') })}><IcoRefresh /> Refresh</Button>
      {local && <Button className="ghost" disabled={busy} onClick={() => void task(async () => { const images = { ...settings?.avatarOverrides }; delete images[key]; await onPersist({ avatarOverrides: images }); setNotice('Using Gravatar again.') })}>Use Gravatar</Button>}
      {local && <Button className="ghost" disabled={busy} onClick={() => void task(async () => { await window.spoon.profile.export(local) })}>Export PNG</Button>}
    </div>
    <div className="profile-generator"><h4><IcoAi /> Generate an illustrated avatar</h4><p className="hint">Uses your installed CLI and its existing login and model. The generated illustration appears here for review before you apply it.</p>
      <label htmlFor="avatar-agent">Local CLI or agent</label><div className="profile-agent-row"><select id="avatar-agent" value={agent} disabled={busy || !agents.length} onChange={(e) => setAgent(e.target.value)}>{!agents.length && <option value="">No supported CLI detected</option>}{agents.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><Button className="ghost" disabled={busy} onClick={() => void task(async () => { const value = await window.spoon.profile.generators(true); setAgents(value); setAgent((current) => value.some((item: LauncherInfo) => item.id === current) ? current : value[0]?.id ?? '') })}>Detect again</Button></div>
      <label htmlFor="avatar-prompt">Describe your avatar</label><textarea id="avatar-prompt" value={description} maxLength={2000} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
      <div className="profile-actions"><Button className="primary" disabled={busy || !agent || !description.trim() || !key} onClick={() => void task(async () => { generating.current = true; const image = await window.spoon.profile.generate(agent, description); if (mounted.current) setPreview(image) })}><IcoAi /> {busy && generating.current ? 'Generating…' : 'Generate avatar'}</Button>{busy && generating.current && <Button onClick={() => void window.spoon.profile.cancel()}>Cancel</Button>}</div>
    </div>
    {preview && <div className="profile-preview"><img src={preview} alt="Avatar preview" /><div><strong>Preview</strong><p className="hint">Apply locally or export to upload to Gravatar.</p><div className="profile-actions"><Button className="primary" disabled={busy || !key} onClick={() => void task(apply)}>Use this photo</Button><Button disabled={busy} onClick={() => void task(async () => { await window.spoon.profile.export(preview) })}>Export PNG</Button><Button className="ghost" disabled={busy} onClick={() => setPreview('')}>Discard</Button></div></div></div>}
    {error && <p className="profile-error" role="alert">{error}</p>}{notice && <p className="hint" role="status">{notice}</p>}
  </section>
}

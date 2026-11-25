import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, Pencil, Plus, ShieldAlert, Trash2, UserRound } from 'lucide-react'
import type { GitCredentialInfo, GitIdentity, GitIdentityInfo, SystemCredentialInfo } from '../../shared/types'
import { Button } from './Button'

const clean = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': Error: /, '')
const emailOk = (value: string) => /^\S+@\S+$/.test(value.trim())

/** Hosts that only take a personal access token as the Git password. */
export function tokenOnlyHost(url: string): boolean {
  const host = url.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]*@/, '').split('/')[0] ?? ''
  return /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|dev\.azure\.com)$/i.test(host)
}

/** Name and email fields shared by the global identity, the repository override and the first-run prompt. */
export function IdentityFields({ value, onChange, disabled, idPrefix }: { value: GitIdentity; onChange: (next: GitIdentity) => void; disabled?: boolean; idPrefix: string }) {
  return (
    <div className="field-grid">
      <div>
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} value={value.name} disabled={disabled} placeholder="Ada Lovelace" autoComplete="off" onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-email`}>Email</label>
        <input id={`${idPrefix}-email`} type="email" value={value.email} disabled={disabled} placeholder="ada@example.com" autoComplete="off" onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </div>
    </div>
  )
}

type Draft = { id?: string; url: string; username: string; password: string }

/** Preferences → Accounts: who signs the commits, and the logins Git uses for remotes. */
export function GitAccounts({ repo }: { repo?: string }) {
  const [info, setInfo] = useState<GitIdentityInfo | null>(null)
  const [global, setGlobal] = useState<GitIdentity>({ name: '', email: '' })
  const [local, setLocal] = useState<GitIdentity>({ name: '', email: '' })
  const [accounts, setAccounts] = useState<GitCredentialInfo[]>([])
  const [system, setSystem] = useState<SystemCredentialInfo[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)

  const applyInfo = (next: GitIdentityInfo) => {
    setInfo(next)
    setGlobal(next.global)
    setLocal(next.local ?? { name: '', email: '' })
  }

  useEffect(() => {
    mounted.current = true
    void window.spoon.credentials.identity(repo).then((next: GitIdentityInfo) => mounted.current && applyInfo(next)).catch(() => {})
    void window.spoon.credentials.list().then((next: GitCredentialInfo[]) => mounted.current && setAccounts(next)).catch(() => {})
    void window.spoon.credentials.system().then((next: SystemCredentialInfo[]) => mounted.current && setSystem(next)).catch(() => {})
    return () => {
      mounted.current = false
    }
  }, [repo])

  async function task(action: () => Promise<string | void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const done = await action()
      if (mounted.current && done) setNotice(done)
    } catch (reason) {
      if (mounted.current) setError(clean(reason))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const globalDirty = !!info && (global.name.trim() !== info.global.name || global.email.trim() !== info.global.email)
  const globalReady = !!global.name.trim() && emailOk(global.email)
  const localSet = !!info?.local && (!!info.local.name || !!info.local.email)
  const localDirty = !!info?.local && (local.name.trim() !== info.local.name || local.email.trim() !== info.local.email)
  const localReady = !!local.name.trim() && emailOk(local.email)
  const repoName = repo?.split(/[\\/]/).filter(Boolean).pop()
  const otherHelpers = (info?.helpers ?? []).filter((helper) => !/credential\.sh/.test(helper))

  function saveDraft(e: FormEvent) {
    e.preventDefault()
    if (!draft) return
    void task(async () => {
      setAccounts(await window.spoon.credentials.save({ id: draft.id, url: draft.url.trim(), username: draft.username.trim(), password: draft.password || undefined }))
      setDraft(null)
      return draft.id ? 'Account updated.' : 'Account saved. Git will use it for that server.'
    })
  }

  return (
    <section className="prefs-pane git-accounts" role="tabpanel" id="prefs-panel-accounts" aria-labelledby="prefs-tab-accounts">
      <h3>Commit identity</h3>
      <p className="hint">Git signs every commit with this name and email. It applies to all your repositories.</p>
      <form
        className="account-card"
        aria-label="Global identity"
        onSubmit={(e) => {
          e.preventDefault()
          void task(async () => {
            applyInfo(await window.spoon.credentials.setIdentity('global', global, repo))
            return 'Identity saved for every repository.'
          })
        }}
      >
        <IdentityFields idPrefix="identity-global" value={global} onChange={setGlobal} disabled={busy} />
        {info && (!info.global.name || !info.global.email) && (
          <p className="account-warning" role="status">
            <ShieldAlert aria-hidden="true" /> Git has no name or email yet, so it cannot create commits.
          </p>
        )}
        <div className="account-actions">
          <Button className="primary" type="submit" disabled={busy || !globalDirty || !globalReady}>
            Save identity
          </Button>
        </div>
      </form>

      {repo && info?.local && (
        <>
          <h3>Only in {repoName}</h3>
          <p className="hint">Use a different name and email in this repository, for example a work address. Leave it empty to follow the identity above.</p>
          <form
            className="account-card"
            aria-label="Repository identity"
            onSubmit={(e) => {
              e.preventDefault()
              void task(async () => {
                applyInfo(await window.spoon.credentials.setIdentity('local', local, repo))
                return `Identity saved for ${repoName}.`
              })
            }}
          >
            <IdentityFields idPrefix="identity-local" value={local} onChange={setLocal} disabled={busy} />
            <div className="account-actions">
              <Button className="primary" type="submit" disabled={busy || !localDirty || !localReady}>
                Save for this repository
              </Button>
              {localSet && (
                <Button
                  className="ghost"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      applyInfo(await window.spoon.credentials.setIdentity('local', { name: '', email: '' }, repo))
                      return `${repoName} follows the global identity again.`
                    })
                  }
                >
                  Use the global identity
                </Button>
              )}
            </div>
          </form>
        </>
      )}

      <div className="account-heading">
        <h3>Saved accounts</h3>
        {!draft && (
          <Button className="ghost" type="button" disabled={busy} onClick={() => setDraft({ url: '', username: '', password: '' })}>
            <Plus aria-hidden="true" /> Add account
          </Button>
        )}
      </div>
      <p className="hint">
        Usernames and passwords (or personal access tokens) for HTTPS remotes. Git uses them to clone, fetch, pull and push without asking. Passwords are encrypted
        by Windows and never leave this computer.
      </p>

      {draft && (
        <form className="account-card account-form" aria-label={draft.id ? 'Edit account' : 'Add account'} onSubmit={saveDraft}>
          <label htmlFor="account-url">Server</label>
          <input id="account-url" autoFocus value={draft.url} disabled={busy} placeholder="https://github.com" autoComplete="off" onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <div className="field-grid">
            <div>
              <label htmlFor="account-user">Username</label>
              <input id="account-user" value={draft.username} disabled={busy} autoComplete="off" onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            </div>
            <div>
              <label htmlFor="account-pass">{tokenOnlyHost(draft.url) ? 'Personal access token' : 'Password or token'}</label>
              <input
                id="account-pass"
                type="password"
                value={draft.password}
                disabled={busy}
                autoComplete="new-password"
                placeholder={draft.id ? 'Leave empty to keep the saved one' : ''}
                onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              />
            </div>
          </div>
          {tokenOnlyHost(draft.url) && <p className="hint">This server does not accept your account password for Git. Create a personal access token and paste it here.</p>}
          <div className="account-actions">
            <Button className="primary" type="submit" disabled={busy || !draft.url.trim() || !draft.username.trim() || (!draft.id && !draft.password)}>
              {draft.id ? 'Save changes' : 'Save account'}
            </Button>
            <Button className="ghost" type="button" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {accounts.length ? (
        <ul className="account-list" aria-label="Saved accounts">
          {accounts.map((account) => (
            <li key={account.id} className={`account-row ${account.rejected ? 'rejected' : ''}`}>
              <span className="account-ico" aria-hidden="true">
                <KeyRound />
              </span>
              <span className="account-text">
                <strong>{account.host}</strong>
                <span className="hint">
                  <UserRound aria-hidden="true" /> {account.username}
                  {account.url.startsWith('http://') ? ' · http' : ''}
                </span>
              </span>
              {account.rejected && (
                <span className="account-badge" title="The server refused this password the last time Git used it. Edit the account to fix it.">
                  Password refused
                </span>
              )}
              <Button variant="icon" aria-label={`Edit ${account.username} at ${account.host}`} title="Edit" disabled={busy} onClick={() => setDraft({ id: account.id, url: account.url, username: account.username, password: '' })}>
                <Pencil aria-hidden="true" />
              </Button>
              <Button
                variant="icon"
                aria-label={`Remove ${account.username} at ${account.host}`}
                title="Remove"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    if (!(await window.spoon.app.confirm(`Remove ${account.username} at ${account.host}?`, 'Git will ask for the password the next time it needs it.'))) return
                    setAccounts(await window.spoon.credentials.remove(account.id))
                    if (draft?.id === account.id) setDraft(null)
                    return 'Account removed.'
                  })
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !draft && <p className="account-empty">No saved accounts yet. Spoon offers to remember one the first time a remote asks you to sign in.</p>
      )}

      {(system.length > 0 || otherHelpers.length > 0) && (
        <>
          <h3>Windows Credential Manager</h3>
          <p className="hint">
            {otherHelpers.length
              ? `Git also uses ${otherHelpers.join(', ')} to keep logins. Accounts saved in Spoon are tried first.`
              : 'Logins that Git Credential Manager saved on this computer.'}
          </p>
          {system.length > 0 && (
            <ul className="account-list" aria-label="Windows Credential Manager">
              {system.map((item) => (
                <li key={item.target} className="account-row">
                  <span className="account-ico" aria-hidden="true">
                    <KeyRound />
                  </span>
                  <span className="account-text">
                    <strong>{item.url.replace(/^https?:\/\//i, '')}</strong>
                    <span className="hint">
                      <UserRound aria-hidden="true" /> {item.username || 'Signed in'}
                    </span>
                  </span>
                  <Button
                    variant="icon"
                    aria-label={`Sign out of ${item.url}`}
                    title="Sign out"
                    disabled={busy}
                    onClick={() =>
                      void task(async () => {
                        if (!(await window.spoon.app.confirm(`Sign out of ${item.url}?`, 'This removes the login from Windows Credential Manager. Git will ask you to sign in again.'))) return
                        setSystem(await window.spoon.credentials.removeSystem(item.target))
                        return 'Signed out.'
                      })
                    }
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="hint" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}

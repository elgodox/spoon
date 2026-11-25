// Git accounts: the saved-credential store, Spoon's credential helper (get / store / erase),
// the Windows Credential Manager listing, the Git identity, and the features that ride along
// with this release (undo commit, .gitignore, tag push). The network tests use a real
// password-protected Git HTTP server.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as git from '../../src/main/git.ts'
import * as store from '../../src/main/store.ts'
import * as credentials from '../../src/main/git-credentials.ts'
import { createAskpassResponder, startAskpass } from '../../src/main/askpass.ts'
import type { CredentialAnswer, CredentialRequest } from '../../src/shared/types.ts'
import { commitAll, log, makeRemotePair, makeRepo, sandboxDir, sh, write } from '../support/repo.ts'
import { authGitServer } from '../support/git-http.mjs'

process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost'

const reset = () => store.setGitCreds([])

test('parseRemote reads URLs, user@ prefixes and bare hosts', () => {
  assert.deepEqual(credentials.parseRemote('https://github.com/org/repo.git'), { protocol: 'https', host: 'github.com', username: undefined })
  assert.deepEqual(credentials.parseRemote('HTTPS://Alan@GitHub.com'), { protocol: 'https', host: 'github.com', username: 'Alan' })
  assert.deepEqual(credentials.parseRemote('http://127.0.0.1:8080/x'), { protocol: 'http', host: '127.0.0.1:8080', username: undefined })
  assert.deepEqual(credentials.parseRemote('git.example.com:8443'), { protocol: 'https', host: 'git.example.com:8443' })
  assert.equal(credentials.parseRemote(''), null)
  assert.equal(credentials.parseRemote('not a url'), null)
})

test('accounts: add, list without the password, edit keeps the password, remove', () => {
  reset()
  assert.throws(() => credentials.saveCredential({ url: 'nope', username: 'a', password: 'b' }), /server address/)
  assert.throws(() => credentials.saveCredential({ url: 'ssh://git@github.com', username: 'a', password: 'b' }), /SSH/)
  assert.throws(() => credentials.saveCredential({ url: 'https://github.com', username: ' ', password: 'b' }), /username/)
  assert.throws(() => credentials.saveCredential({ url: 'https://github.com', username: 'alan' }), /password/)

  let list = credentials.saveCredential({ url: 'https://github.com/elgodox/spoon.git', username: 'alan', password: 'tok3n' })
  assert.equal(list.length, 1)
  assert.equal(list[0].url, 'https://github.com')
  assert.equal(list[0].username, 'alan')
  assert.ok(!JSON.stringify(list).includes('tok3n'), 'the password never reaches the renderer')
  assert.ok(!readFileSync(join(process.env.SPOON_TEST_USERDATA!, 'spoon.json'), 'utf8').includes('tok3n'), 'the password is not stored as plain text')
  assert.deepEqual(credentials.findCredential({ protocol: 'https', host: 'github.com' }), { username: 'alan', password: 'tok3n' })

  // The same server and user again replaces the entry instead of duplicating it.
  list = credentials.saveCredential({ url: 'github.com', username: 'ALAN', password: 'next' })
  assert.equal(list.length, 1)
  assert.equal(credentials.findCredential({ protocol: 'https', host: 'github.com' })?.password, 'next')

  // Editing without a password keeps the saved one.
  list = credentials.saveCredential({ id: list[0].id, url: 'https://gitlab.com', username: 'alan' })
  assert.equal(list[0].url, 'https://gitlab.com')
  assert.equal(credentials.findCredential({ protocol: 'https', host: 'gitlab.com' })?.password, 'next')
  assert.equal(credentials.findCredential({ protocol: 'https', host: 'github.com' }), null)

  // A second account on the same server: Git's username picks between them.
  credentials.saveCredential({ url: 'https://gitlab.com', username: 'work', password: 'w' })
  assert.equal(credentials.listCredentials().length, 2)
  assert.equal(credentials.findCredential({ protocol: 'https', host: 'gitlab.com', username: 'work' })?.password, 'w')
  assert.equal(credentials.findCredential({ protocol: 'https', host: 'gitlab.com', username: 'alan' })?.password, 'next')

  assert.equal(credentials.removeCredential(list[0].id).length, 1)
})

test('credential helper: get answers, store keeps what the user asked to remember, erase marks it rejected', () => {
  reset()
  const ask = 'protocol=https\nhost=example.com\n'
  assert.equal(credentials.credentialHelper('get', ask), '')

  // A login that was not marked "Remember" is not saved.
  credentials.credentialHelper('store', `${ask}username=alan\npassword=one\n`)
  assert.equal(credentials.listCredentials().length, 0)

  // Remember: saved only after Git says the remote accepted it.
  const request: CredentialRequest = { prompt: "Username for 'https://example.com':", kind: 'username', target: 'https://example.com' }
  credentials.noteAnswer(request, { value: 'alan', password: 'one', remember: true })
  assert.equal(credentials.listCredentials().length, 0)
  credentials.credentialHelper('store', `${ask}username=alan\npassword=one\n`)
  assert.equal(credentials.listCredentials().length, 1)
  assert.equal(credentials.credentialHelper('get', ask), 'username=alan\npassword=one\n')
  assert.ok(credentials.listCredentials()[0].usedAt)
  // Git already has a password: nothing to add.
  assert.equal(credentials.credentialHelper('get', `${ask}username=alan\npassword=x\n`), '')

  // A different password for another user does not touch the entry.
  credentials.credentialHelper('erase', `${ask}username=bob\npassword=one\n`)
  assert.equal(credentials.listCredentials()[0].rejected, undefined)

  // The remote refused the saved password: keep the account, stop offering it, tell the dialog.
  credentials.credentialHelper('erase', `${ask}username=alan\npassword=one\n`)
  assert.equal(credentials.listCredentials()[0].rejected, true)
  assert.equal(credentials.credentialHelper('get', ask), '')
  assert.deepEqual(credentials.describeRequest(request), { ...request, suggestedUsername: 'alan', rejected: true })

  // A login that works afterwards (typed again, or from another helper) repairs the account.
  credentials.credentialHelper('store', `${ask}username=alan\npassword=two\n`)
  assert.equal(credentials.listCredentials()[0].rejected, undefined)
  assert.equal(credentials.credentialHelper('get', ask), 'username=alan\npassword=two\n')

  // "Password for 'https://user@host'" prompts remember too; unticking forgets the pending login.
  const pass: CredentialRequest = { prompt: "Password for 'https://eve@other.dev':", kind: 'password', target: 'https://eve@other.dev' }
  credentials.noteAnswer(pass, { value: 'pw', remember: true })
  credentials.noteAnswer(pass, { value: 'pw' })
  credentials.credentialHelper('store', 'protocol=https\nhost=other.dev\nusername=eve\npassword=pw\n')
  assert.equal(credentials.listCredentials().length, 1)
  credentials.noteAnswer(pass, { value: 'pw', remember: true })
  credentials.credentialHelper('store', 'protocol=https\nhost=other.dev\nusername=eve\npassword=pw\n')
  assert.equal(credentials.listCredentials().length, 2)
})

test('Windows Credential Manager: parses cmdkey in any language and removes only Git logins', async () => {
  const english = [
    '',
    'Currently stored credentials:',
    '',
    '    Target: LegacyGeneric:target=git:https://github.com',
    '    Type: Generic ',
    '    User: elgodox',
    '    Local machine persistence',
    '',
    '    Target: LegacyGeneric:target=MicrosoftAccount:user=someone',
    '    Type: Generic ',
    '    User: someone',
    '',
    '    Target: LegacyGeneric:target=git:https://dev.azure.com/org',
    '    Type: Generic ',
    ''
  ].join('\r\n')
  assert.deepEqual(credentials.parseCmdkey(english), [
    { target: 'git:https://dev.azure.com/org', url: 'https://dev.azure.com/org', username: '' },
    { target: 'git:https://github.com', url: 'https://github.com', username: 'elgodox' }
  ])
  const spanish = '\r\nCredenciales almacenadas actualmente:\r\n\r\n    Destino: LegacyGeneric:target=git:https://gitlab.com\r\n    Tipo: Genérico \r\n    Usuario: alan\r\n'
  assert.deepEqual(credentials.parseCmdkey(spanish), [{ target: 'git:https://gitlab.com', url: 'https://gitlab.com', username: 'alan' }])

  const ran: string[][] = []
  let output = english
  const runner = async (_file: string, args: string[]) => {
    ran.push(args)
    if (args[0].startsWith('/delete:')) output = spanish
    return output
  }
  assert.equal((await credentials.listSystemCredentials(runner)).length, 2)
  await assert.rejects(credentials.removeSystemCredential('MicrosoftAccount:user=someone', runner), /no longer/)
  await assert.rejects(credentials.removeSystemCredential('git:https://unknown.example', runner), /no longer/)
  const left = await credentials.removeSystemCredential('git:https://github.com', runner)
  assert.ok(ran.some((args) => args[0] === '/delete:git:https://github.com'))
  assert.equal(left.length, 1)
})

test('saved accounts sign Git in: clone, push and background fetch without a dialog; a refused password asks again', async () => {
  reset()
  const { bare } = makeRemotePair()
  const { url, server, attempts } = await authGitServer(join(bare, '..'), 'alan', 'tok3n')
  const asked: CredentialRequest[] = []
  let reply: CredentialAnswer | null = null
  const env = await startAskpass(
    sandboxDir('askpass-'),
    createAskpassResponder(async (request) => {
      const shown = credentials.describeRequest(request)
      asked.push(shown)
      credentials.noteAnswer(request, reply)
      return reply
    }),
    process.execPath,
    credentials.credentialHelper
  )
  git.setPromptEnv(env)
  try {
    const dir = sandboxDir('clone-saved-')

    // 1. First clone: nothing saved, Spoon asks and the user ticks "Remember".
    reply = { value: 'alan', password: 'tok3n', remember: true }
    const first = await git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'first' })
    assert.ok(existsSync(join(first, 'README.md')))
    assert.equal(asked.length, 1)
    assert.deepEqual(credentials.listCredentials().map((c) => [c.url, c.username]), [[url, 'alan']])

    // 2. From now on Git is signed in: clone, push and the background fetch never ask.
    asked.length = 0
    reply = null
    const second = await git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'second' })
    await git.git(second, ['commit', '--allow-empty', '-q', '-m', 'signed in'])
    await git.pushRemote(second, {})
    await git.fetchRemote(first, { all: true, background: true })
    assert.deepEqual(log(first, 'origin/main').slice(0, 1), ['signed in'])
    assert.equal(asked.length, 0)

    // 3. The password changes on the server side (here: the saved one is wrong).
    const id = credentials.listCredentials()[0].id
    credentials.saveCredential({ id, url, username: 'alan', password: 'expired' })
    await assert.rejects(git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'refused' }), /refused the username or password[\s\S]*Preferences/)
    assert.ok(attempts.includes('alan:expired'))
    assert.equal(credentials.listCredentials()[0].rejected, true)
    assert.equal(asked.length, 0)

    // 4. The next try asks again, pre-filled, and a working login repairs the saved account.
    reply = { value: 'alan', password: 'tok3n', remember: true }
    const third = await git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'third' })
    assert.ok(existsSync(join(third, 'README.md')))
    assert.equal(asked.length, 1)
    assert.equal(asked[0].suggestedUsername, 'alan')
    assert.equal(asked[0].rejected, true)
    assert.equal(credentials.listCredentials()[0].rejected, undefined)
    assert.equal(credentials.findCredential({ protocol: 'http', host: url.replace('http://', '') })?.password, 'tok3n')

    // 5. An account added by hand in Preferences works the same way.
    reset()
    credentials.saveCredential({ url, username: 'alan', password: 'tok3n' })
    asked.length = 0
    reply = null
    assert.ok(existsSync(join(await git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'manual' }), 'README.md')))
    assert.equal(asked.length, 0)
  } finally {
    git.setPromptEnv({})
    server.close()
  }
})

test("Spoon's helper runs first and the helpers Git already had stay behind it", async () => {
  const repo = makeRepo('helpers')
  const env = await startAskpass(sandboxDir('askpass-'), async () => null, process.execPath, () => '')
  const config = process.env.SPOON_TEST_GITCONFIG!
  const before = readFileSync(config, 'utf8')
  try {
    git.setPromptEnv({})
    assert.deepEqual(await git.credentialArgs(repo), [])
    git.setPromptEnv(env)
    writeFileSync(config, `${before}[credential]\n\thelper = manager\n[credential "https://dev.azure.com"]\n\thelper = azure\n\tuseHttpPath = true\n`)
    sh(repo, ['config', 'credential.helper', 'cache --timeout=60'])
    const args = await git.credentialArgs(repo)
    const values = args.filter((_, i) => i % 2 === 1)
    assert.ok(args.every((arg, i) => i % 2 === 1 || arg === '-c'))
    assert.equal(values[0], 'credential.helper=')
    assert.match(values[1], /^credential\.helper=!sh ".*credential\.sh"$/)
    assert.deepEqual(values.slice(2), ['credential.helper=manager', 'credential.https://dev.azure.com.helper=azure', 'credential.helper=cache --timeout=60'])
    // Git accepts the rebuilt list: after the empty value that clears the configured helpers,
    // Spoon's comes first and the others follow in their original order.
    const all = sh(repo, [...args, 'config', '--get-all', 'credential.helper']).split('\n').slice(0, -1)
    const listed = all.slice(all.lastIndexOf('') + 1)
    assert.equal(listed.length, 3)
    assert.match(listed[0], /credential\.sh/)
    assert.deepEqual(listed.slice(1), ['manager', 'cache --timeout=60'])
  } finally {
    writeFileSync(config, before)
    git.setPromptEnv({})
  }
})

test('identity: global and per-repository name and email', async () => {
  const repo = makeRepo('who')
  let info = await git.identityInfo(repo)
  assert.deepEqual(info.global, { name: 'Spoon Test', email: 'spoon-test@example.com' })
  assert.deepEqual(info.local, { name: '', email: '' })
  assert.equal((await git.identityInfo()).local, undefined)

  await assert.rejects(git.setIdentity('global', { name: '', email: 'a@b.c' }), /required/)
  await assert.rejects(git.setIdentity('global', { name: 'A', email: 'nope' }), /email/)
  await assert.rejects(git.setIdentity('local', { name: 'Only name', email: '' }, repo), /both/)
  await assert.rejects(git.setIdentity('local', { name: 'A', email: 'a@b.c' }), /Open a repository/)

  info = await git.setIdentity('local', { name: 'Work Me', email: 'me@work.dev' }, repo)
  assert.deepEqual(info.local, { name: 'Work Me', email: 'me@work.dev' })
  assert.deepEqual(await git.identity(repo), { name: 'Work Me', email: 'me@work.dev' })
  assert.deepEqual(info.global, { name: 'Spoon Test', email: 'spoon-test@example.com' })

  // Clearing the repository identity goes back to the global one.
  info = await git.setIdentity('local', { name: '', email: '' }, repo)
  assert.deepEqual(info.local, { name: '', email: '' })
  assert.deepEqual(await git.identity(repo), { name: 'Spoon Test', email: 'spoon-test@example.com' })

  const config = process.env.SPOON_TEST_GITCONFIG!
  const before = readFileSync(config, 'utf8')
  try {
    info = await git.setIdentity('global', { name: 'Ada Lovelace', email: 'ada@example.com' })
    assert.deepEqual(info.global, { name: 'Ada Lovelace', email: 'ada@example.com' })
    assert.equal(sh(repo, ['config', '--global', 'user.name']).trim(), 'Ada Lovelace')
  } finally {
    writeFileSync(config, before)
  }
})

test('undoLastCommit keeps the changes staged and returns the message', async () => {
  const repo = makeRepo('undo')
  write(repo, 'a.txt', 'a')
  sh(repo, ['add', '-A'])
  sh(repo, ['commit', '-q', '-m', 'feat: add a', '-m', 'With a body.'])
  assert.equal(await git.undoLastCommit(repo), 'feat: add a\n\nWith a body.')
  assert.deepEqual(log(repo), ['Initial commit'])
  assert.equal(sh(repo, ['diff', '--cached', '--name-only']).trim(), 'a.txt')

  // The very first commit can be undone too.
  assert.equal(await git.undoLastCommit(repo), 'Initial commit')
  assert.equal(sh(repo, ['status', '--porcelain']).trim().split('\n').sort().join(), 'A  README.md,A  a.txt')
  await assert.rejects(git.undoLastCommit(repo), /no commit to undo/)

  // A merge commit is left to Reset.
  const merged = makeRepo('undo-merge')
  sh(merged, ['checkout', '-q', '-b', 'side'])
  write(merged, 'side.txt', 's')
  commitAll(merged, 'side')
  sh(merged, ['checkout', '-q', 'main'])
  write(merged, 'main.txt', 'm')
  commitAll(merged, 'main work')
  sh(merged, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'])
  await assert.rejects(git.undoLastCommit(merged), /merge/)
})

test('ignorePaths appends to .gitignore once and hides the files from status', async () => {
  const repo = makeRepo('ignore')
  write(repo, 'debug.log', 'x')
  write(repo, 'build/out.bin', 'x')
  assert.deepEqual(await git.ignorePaths(repo, ['debug.log', 'build\\']), ['debug.log', 'build/'])
  assert.equal(readFileSync(join(repo, '.gitignore'), 'utf8'), 'debug.log\nbuild/\n')
  assert.deepEqual((await git.getStatus(repo)).untracked.map((e) => e.path), ['.gitignore'])
  // Already listed, blank and duplicate patterns are skipped; a file without a final newline is handled.
  writeFileSync(join(repo, '.gitignore'), 'debug.log\nbuild/')
  assert.deepEqual(await git.ignorePaths(repo, ['debug.log', ' ', '*.tmp', '*.tmp']), ['*.tmp'])
  assert.equal(readFileSync(join(repo, '.gitignore'), 'utf8'), 'debug.log\nbuild/\n*.tmp\n')
})

test('pushTag and deleteRemoteTag publish and remove one tag', async () => {
  const { bare, clone } = makeRemotePair()
  sh(clone, ['tag', 'v1.0.0'])
  sh(clone, ['tag', 'v2.0.0'])
  await git.pushTag(clone, 'v1.0.0')
  assert.equal(sh(bare, ['tag', '--list']).trim(), 'v1.0.0')
  await git.deleteRemoteTag(clone, 'v1.0.0')
  assert.equal(sh(bare, ['tag', '--list']).trim(), '')
  assert.equal(sh(clone, ['tag', '--list']).trim().split('\n').length, 2, 'local tags stay')
  await assert.rejects(git.pushTag(makeRepo('lonely'), 'v1'), /no remote/)
})

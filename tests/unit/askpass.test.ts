// Credential prompts: Git runs without a terminal, so clone / fetch / pull / push over HTTPS
// must ask the user through Spoon's askpass helper instead of failing with
// "terminal prompts disabled". The clone tests run against a real password-protected
// Git HTTP server (git http-backend behind Basic auth).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as git from '../../src/main/git.ts'
import { classifyPrompt, createAskpassResponder, startAskpass } from '../../src/main/askpass.ts'
import type { CredentialAnswer, CredentialRequest } from '../../src/shared/types.ts'
import { makeRemotePair, sandboxDir } from '../support/repo.ts'
import { authGitServer } from '../support/git-http.mjs'

// The container or CI may route HTTP through a proxy; the test server is local.
process.env.NO_PROXY = process.env.no_proxy = '127.0.0.1,localhost'

test('classifyPrompt reads Git and SSH prompts', () => {
  assert.deepEqual(classifyPrompt("Username for 'https://github.com': "), { prompt: "Username for 'https://github.com':", kind: 'username', target: 'https://github.com' })
  assert.deepEqual(classifyPrompt("Password for 'https://alan@github.com': "), { prompt: "Password for 'https://alan@github.com':", kind: 'password', target: 'https://alan@github.com' })
  assert.equal(classifyPrompt("Enter passphrase for key '/c/Users/me/.ssh/id_ed25519': ").kind, 'password')
  assert.equal(classifyPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ').kind, 'confirm')
  assert.equal(classifyPrompt('Verification code: ').kind, 'text')
})

test('the username dialog also answers the password prompt that follows it', async () => {
  const asked: CredentialRequest[] = []
  const respond = createAskpassResponder(async (request) => {
    asked.push(request)
    return request.kind === 'username' ? { value: 'alan', password: 's3cret' } : { value: 'typed' }
  })
  assert.equal(await respond("Username for 'https://github.com': "), 'alan')
  assert.equal(await respond("Password for 'https://alan@github.com': "), 's3cret')
  assert.equal(asked.length, 1)
  // The remembered password is used once; a retry asks again.
  assert.equal(await respond("Password for 'https://alan@github.com': "), 'typed')
  assert.equal(asked.length, 2)
})

test('cloneRepo over HTTPS-style auth fails without a prompt and works when Spoon asks for credentials', async () => {
  const { bare } = makeRemotePair()
  const root = join(bare, '..')
  const { url, server, attempts } = await authGitServer(root, 'alan', 'tok3n')
  const asked: CredentialRequest[] = []
  let reply: CredentialAnswer | null = { value: 'alan', password: 'tok3n' }
  const env = await startAskpass(sandboxDir('askpass-'), createAskpassResponder(async (request) => {
    asked.push(request)
    return reply
  }))
  try {
    const dir = sandboxDir('clone-auth-')

    // Before the fix: no credential helper and no terminal → Git gives up.
    git.setPromptEnv({})
    await assert.rejects(git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'no-prompt' }), /terminal prompts disabled[\s\S]*personal access token/)
    assert.equal(asked.length, 0)

    git.setPromptEnv(env)
    const target = await git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'signed-in' })
    assert.equal(await git.isRepo(target), true)
    assert.ok(existsSync(join(target, 'README.md')))
    assert.deepEqual(asked.map((r) => r.kind), ['username'])
    assert.equal(asked[0].target, url)
    assert.ok(attempts.includes('alan:tok3n'))

    // Push uses the same prompt.
    asked.length = 0
    await git.git(target, ['commit', '--allow-empty', '-q', '-m', 'from spoon'])
    await git.pushRemote(target, {})
    assert.deepEqual(asked.map((r) => r.kind), ['username'])

    // Background fetches never pop a dialog.
    asked.length = 0
    await assert.rejects(git.fetchRemote(target, { all: true, background: true }), /terminal prompts disabled/)
    assert.equal(asked.length, 0)

    // Cancel → a clear error, not a hang.
    reply = null
    await assert.rejects(git.cloneRepo({ url: `${url}/origin.git`, directory: dir, name: 'canceled' }), /personal access token/)
    assert.deepEqual(asked.map((r) => r.kind), ['username'])
  } finally {
    git.setPromptEnv({})
    server.close()
  }
})

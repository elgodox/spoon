const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')
const sharp = require('sharp')

async function load(file, plugins = []) {
  const built = await esbuild.build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, plugins })
  const mod = new Module(path.resolve(file + '.cjs'), module)
  mod.filename = path.resolve(file + '.cjs')
  mod.paths = module.paths
  mod._compile(built.outputFiles[0].text, mod.filename)
  return mod.exports
}

async function main() {
  const { firstChangedLine, workingLine, mapIndexLine } = await load('src/shared/change-location.ts')
  const hunk = { oldStart: 8, newStart: 8, oldCount: 3, newCount: 3, lines: [
    { type: 'context', oldNo: 8, newNo: 8, text: 'a' }, { type: 'del', oldNo: 9, text: 'old' },
    { type: 'add', newNo: 9, text: 'new' }, { type: 'context', oldNo: 10, newNo: 10, text: 'z' }
  ] }
  assert.equal(firstChangedLine({ hunks: [hunk] }), 9)
  assert.equal(workingLine(hunk, hunk.lines[1]), 9)
  assert.equal(mapIndexLine(9, { hunks: [hunk] }), 9)
  const insertion = { oldStart: 0, oldCount: 0, newStart: 1, newCount: 3, lines: [] }
  assert.equal(mapIndexLine(10, { hunks: [insertion] }), 13)
  assert.equal(firstChangedLine(), 1)
  const deletion = { oldStart: 2, oldCount: 2, newStart: 1, newCount: 0, lines: [{ type: 'del', oldNo: 2, text: 'gone' }] }
  assert.equal(mapIndexLine(7, { hunks: [deletion] }), 5)
  assert.equal(mapIndexLine(2, { hunks: [deletion] }), 1)

  const command = await load('src/main/command.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spoon-actions-test-'))
  try {
    const strange = 'D:\\A folder\\test & $(whoami) %PATH% "quoted" ü.ts:14:1'
    const value = await command.runCommand(process.execPath, ['-e', 'process.stdin.resume();let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({args:process.argv.slice(1),input:s})))', strange], { cwd: dir, input: 'Hello " & $(whoami) á', timeout: 10000 })
    assert.deepEqual(JSON.parse(value), { args: [strange], input: 'Hello " & $(whoami) á' })
    const abort = new AbortController()
    const waiting = command.runCommand(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { cwd: dir, signal: abort.signal })
    setTimeout(() => abort.abort(), 100)
    await assert.rejects(waiting, /canceled/)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#7621df"/><circle cx="128" cy="128" r="75" fill="#fff"/></svg>'
  global.__avatarTest = { svg, calls: [] }
  const stub = { name: 'profile-test', setup(build) {
    build.onResolve({ filter: /^electron$|^\.\/launchers$|^\.\/command$/ }, ({ path: id }) => ({ path: id, namespace: 'profile-test' }))
    build.onLoad({ filter: /.*/, namespace: 'profile-test' }, ({ path: id }) => ({ contents: id === 'electron' ? 'export const dialog = {};' : id === './launchers' ? `export async function listLaunchers(){ return {launchers:['codex','claude','gemini','cursor-agent','grok','opencode'].map(id=>({id,command:id,available:true}))} }` : `export async function runCommand(command,args,opts){ global.__avatarTest.calls.push({command,args}); if(command==='codex') await require('node:fs/promises').writeFile(args[args.indexOf('-o')+1],global.__avatarTest.svg); return global.__avatarTest.svg }` }))
  } }
  const profile = await load('src/main/profile.ts', [stub])
  assert.equal(profile.extractAvatarSvg('Response:\n' + svg), svg)
  assert.equal(profile.extractAvatarSvg(JSON.stringify({ part: { text: svg } })), svg)
  for (const malicious of ['<script>alert(1)</script>', '<image href="file:///secret"/>', '<rect fill="url(https://host)"/>', '<foreignObject/>', '<rect onclick="x()"/>']) {
    assert.throws(() => profile.extractAvatarSvg(svg.replace('<circle', malicious + '<circle')), /unsupported/)
  }
  await assert.rejects(profile.rasterAvatar(Buffer.alloc(8_000_001)), /smaller/)
  for (const id of ['codex','claude','gemini','cursor-agent','grok','opencode']) {
    const image = await profile.generateAvatar(id, 'A purple astronaut')
    const metadata = await sharp(Buffer.from(image.split(',')[1], 'base64')).metadata()
    assert.equal(metadata.width, 256); assert.equal(metadata.height, 256); assert.equal(metadata.format, 'png')
  }
  await assert.rejects(profile.generateAvatar('unknown', 'x'), /not installed/)
  await assert.rejects(profile.generateAvatar('codex', ''), /Describe/)
  const grokArgs = global.__avatarTest.calls.find((call) => call.command === 'grok').args
  assert.ok(grokArgs.includes('--verbatim')); assert.ok(grokArgs.includes('--no-plan'))
  assert.equal(grokArgs[grokArgs.indexOf('--permission-mode') + 1], 'dontAsk')
  if (process.env.SPOON_TEST_LIVE_GROK === '1') {
    const live = { name: 'live-profile', setup(build) {
      build.onResolve({ filter: /^electron$|^\.\/launchers$/ }, ({ path: id }) => ({ path: id, namespace: 'live-profile' }))
      build.onLoad({ filter: /.*/, namespace: 'live-profile' }, ({ path: id }) => ({ contents: id === 'electron' ? 'export const dialog = {};' : 'export async function listLaunchers(){return {launchers:[{id:"grok",command:"grok",available:true}]}}' }))
    } }
    const real = await load('src/main/profile.ts', [live])
    const image = await real.generateAvatar('grok', 'A friendly astronaut in violet and blue, simple bold shapes')
    const metadata = await sharp(Buffer.from(image.split(',')[1], 'base64')).metadata()
    assert.equal(metadata.width, 256); assert.equal(metadata.format, 'png')
    await fs.mkdir('output/workspace-history', { recursive: true })
    await fs.writeFile('output/workspace-history/grok-avatar.png', Buffer.from(image.split(',')[1], 'base64'))
    console.log('Live Grok avatar generated and rasterized successfully.')
  }
  delete global.__avatarTest
  console.log('Profile, SVG validation, editor line mapping, literal arguments and cancellation tests passed.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })

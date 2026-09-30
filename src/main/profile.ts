import { dialog, BrowserWindow } from 'electron'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import sharp from 'sharp'
import { listLaunchers } from './launchers'
import { runCommand } from './command'

const SUPPORTED = new Set(['codex', 'claude', 'gemini', 'cursor-agent', 'grok', 'opencode'])
let generation: AbortController | null = null

export async function generators(force = false) {
  return (await listLaunchers(force)).launchers.filter((item) => item.available && SUPPORTED.has(item.id))
}

export async function rasterAvatar(input: Buffer): Promise<string> {
  if (input.length > 8_000_000) throw new Error('Choose an image smaller than 8 MB.')
  const png = await sharp(input, { limitInputPixels: 16_000_000 }).rotate().resize(256, 256, { fit: 'cover' }).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

export function extractAvatarSvg(output: string): string {
  // OpenCode emits JSON events; other CLIs emit plain text.
  const events = output.split('\n').flatMap((line) => {
    try { const event = JSON.parse(line); return typeof event.part?.text === 'string' ? [event.part.text] : [] } catch { return [] }
  })
  const text = events.length ? events.join('') : output
  const svg = text.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0]
  if (!svg || svg.length > 80_000) throw new Error('The CLI did not return an SVG avatar. Try again with a simpler description.')
  if (/<!|<\s*(script|foreignObject|image|use|iframe)\b|\bon\w+\s*=|\b(?:href|src)\s*=|@import|url\(\s*['"]?(?!#)/i.test(svg)) {
    throw new Error('The avatar contains unsupported external or active content. Ask for a self-contained vector illustration.')
  }
  return svg
}

export async function pickAvatar(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, { title: 'Choose profile photo', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  if ((await stat(result.filePaths[0])).size > 8_000_000) throw new Error('Choose an image smaller than 8 MB.')
  return rasterAvatar(await readFile(result.filePaths[0]))
}

export async function exportAvatar(win: BrowserWindow, data: string): Promise<boolean> {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 8_000_000) throw new Error('Invalid avatar image.')
  const result = await dialog.showSaveDialog(win, { title: 'Export avatar for Gravatar', defaultPath: 'spoon-avatar.png', filters: [{ name: 'PNG', extensions: ['png'] }] })
  if (result.canceled || !result.filePath) return false
  await writeFile(result.filePath, Buffer.from(data.split(',')[1], 'base64'))
  return true
}

export function cancelGeneration(): void { generation?.abort() }

export async function generateAvatar(id: string, description: string): Promise<string> {
  if (generation) throw new Error('An avatar is already being generated.')
  if (!description.trim() || description.length > 2000) throw new Error('Describe your avatar in 1–2000 characters.')
  const controller = new AbortController()
  generation = controller
  let dir: string | undefined
  try {
    const cli = (await generators()).find((item) => item.id === id)
    if (!cli?.command) throw new Error('This CLI is not installed or is no longer on PATH.')
    dir = await mkdtemp(join(tmpdir(), 'spoon-avatar-'))
    const prompt = `Create an original illustrated profile avatar as a single self-contained SVG with viewBox="0 0 256 256". Use bold clean vector shapes, attractive colors, a full square background, and a recognizable central subject suitable for a small profile photo. User description: ${description}\nReturn only the complete SVG markup. No markdown, external resources, images, href, scripts, foreignObject, or text. Do not call tools, access files, run commands, or browse. Draw the illustration directly in your response.`
    const final = join(dir, 'avatar.txt')
    const args: Record<string, string[]> = {
      codex: ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-o', final, '-'],
      claude: ['-p', '--output-format', 'text', '--tools=', '--no-session-persistence'],
      gemini: ['-p', prompt, '--output-format', 'text', '--approval-mode', 'plan'],
      'cursor-agent': ['-p', prompt, '--output-format', 'text', '--mode', 'plan', '--workspace', dir],
      grok: ['-p', prompt, '--verbatim', '--output-format', 'plain', '--no-plan', '--no-subagents', '--disable-web-search', '--permission-mode', 'dontAsk', '--tools=', '--max-turns', '1'],
      opencode: ['run', '--format', 'json', '--agent', 'plan', prompt]
    }
    let output = await runCommand(cli.command, args[id], { cwd: dir, input: id === 'codex' || id === 'claude' ? prompt : undefined, signal: controller.signal })
    if (id === 'codex') output = await readFile(final, 'utf8')
    if (controller.signal.aborted) throw new Error('Generation canceled.')
    return rasterAvatar(Buffer.from(extractAvatarSvg(output)))
  } finally {
    generation = null
    if (dir && resolve(dirname(dir)) === resolve(tmpdir()) && basename(dir).startsWith('spoon-avatar-')) await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {})
  }
}

// Pure helpers shared by main and renderer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  contributionBuckets,
  contributionLevel,
  contributionWeeks,
  dayKey,
  dayKeyFromUnix,
  monthMarks,
  scaleWindow
} from '../../src/shared/activity.ts'
import { customProviderId, findAiSite, openAiUrl, AI_SITE_CATALOG } from '../../src/shared/ai-catalog.ts'
import { firstChangedLine, mapIndexLine, workingLine } from '../../src/shared/change-location.ts'
import { groupLaunchers, launcherById, launcherFromEditor, LAUNCHER_CATALOG } from '../../src/shared/launchers.ts'
import { classifyMedia, formatBytes } from '../../src/shared/media.ts'
import {
  defaultModelFor,
  fallbackAiProvider,
  hasConnectedAi,
  listedProviderIds,
  providerLabel,
  resolveAiProvider
} from '../../src/shared/models.ts'
import {
  iconColorMap,
  resolveAccent,
  sanitizeAccentCustom,
  sanitizeAccentId,
  sanitizeIconStyle,
  sanitizeThemePack,
  THEME_PACKS
} from '../../src/shared/themes.ts'
import {
  clusterGrouped,
  fallbackWorkspaceAnalysis,
  groupKey,
  normalizeWorkspaceColor,
  parseWorkspaceAnalysis,
  sanitizeWorkspaces,
  uniqueRepoPaths,
  workspaceColor,
  WORKSPACE_COLORS
} from '../../src/shared/workspaces.ts'
import { parseHunks } from '../../src/main/git.ts'
import type { DiffHunk, FileDiff } from '../../src/shared/types.ts'

test('activity: day keys, levels and scale windows', () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-1-5')
  assert.equal(dayKeyFromUnix(new Date(2026, 9, 13, 12).getTime() / 1000), '2026-10-13')
  assert.deepEqual([0, 1, 3, 6, 10, 99].map(contributionLevel), [0, 1, 2, 3, 4, 4])
  const now = new Date(2026, 9, 13)
  assert.equal(scaleWindow('day', now).days, 30)
  assert.equal(scaleWindow('week', now).days, 112)
  const month = scaleWindow('month', now)
  assert.equal(month.start.getDate(), 1)
  assert.equal(month.start.getMonth(), 10)
  assert.equal(month.start.getFullYear(), 2025)
  assert.equal(scaleWindow('year', now).start.getFullYear(), 2022)
})

test('activity: buckets per scale cover the window without gaps', () => {
  const now = new Date(2026, 9, 13)
  assert.deepEqual(contributionBuckets('day', now), [])
  const weeks = contributionBuckets('week', now)
  assert.ok(weeks.length >= 16 && weeks.length <= 17)
  assert.equal(weeks.at(-1)!.to.getTime(), new Date(2026, 9, 13).getTime())
  const months = contributionBuckets('month', now)
  assert.equal(months.length, 12)
  assert.equal(months.at(-1)!.key, '2026-10')
  const years = contributionBuckets('year', now)
  assert.deepEqual(years.map((b) => b.key), ['2022', '2023', '2024', '2025', '2026'])
})

test('activity: contribution weeks are Sunday-start and include today', () => {
  const now = new Date(2026, 9, 13)
  const weeks = contributionWeeks(now, 30)
  assert.ok(weeks.every((w) => w.length === 7 && w[0].getDay() === 0))
  assert.ok(weeks.flat().some((d) => d.getTime() === new Date(2026, 9, 13).getTime()))
  const marks = monthMarks(weeks)
  assert.equal(marks.length, weeks.length)
  assert.ok(marks.some(Boolean))
})

test('ai-catalog: site lookup, URL building and custom ids', () => {
  assert.ok(AI_SITE_CATALOG.length > 3)
  assert.equal(findAiSite('lmstudio')?.needsKey, false)
  assert.equal(openAiUrl('https://x.ai/v1/', 'models'), 'https://x.ai/v1/models')
  assert.equal(openAiUrl('https://x.ai/v1/chat/completions', 'models'), 'https://x.ai/v1/models')
  assert.equal(openAiUrl(' https://x.ai/v1// ', 'chat/completions'), 'https://x.ai/v1/chat/completions')
  assert.equal(customProviderId('OpenRouter Work!', []), 'custom-openrouter-work')
  assert.equal(customProviderId('OpenRouter Work!', ['custom-openrouter-work']), 'custom-openrouter-work-2')
  assert.equal(customProviderId('***', []), 'custom-endpoint')
})

test('change-location: map diff lines to editor lines', () => {
  const hunk: DiffHunk = parseHunks('@@ -1,4 +1,5 @@\n a\n-b\n+B\n+B2\n c\n d\n')[0]
  const del = hunk.lines.find((l) => l.type === 'del')!
  const add = hunk.lines.find((l) => l.text === 'B2')!
  assert.equal(workingLine(hunk, del), 2)
  assert.equal(workingLine(hunk, add), 3)
  const diff: FileDiff = { path: 'f', status: 'M', binary: false, image: false, hunks: [hunk], patch: '' }
  assert.equal(firstChangedLine(diff), 2)
  assert.equal(firstChangedLine(undefined), 1)
  assert.equal(mapIndexLine(10, diff), 11)
  assert.equal(mapIndexLine(1, diff), 1)
  assert.equal(mapIndexLine(7), 7)
})

test('launchers: catalog lookups, grouping and legacy editor mapping', () => {
  assert.equal(launcherById('code')?.label, 'VS Code')
  assert.equal(launcherById('nope'), undefined)
  const groups = groupLaunchers(LAUNCHER_CATALOG)
  assert.deepEqual(groups.map((g) => g.kind), ['ide', 'agent', 'cli', 'system'])
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), LAUNCHER_CATALOG.length)
  assert.equal(launcherFromEditor('code'), 'code')
  assert.equal(launcherFromEditor('explorer'), 'explorer')
  assert.equal(launcherFromEditor(undefined), 'cursor')
})

test('media: classify by extension and format sizes', () => {
  assert.deepEqual(classifyMedia('a/B.JPG'), { kind: 'image', mime: 'image/jpeg' })
  assert.equal(classifyMedia('song.flac')?.kind, 'audio')
  assert.equal(classifyMedia('clip.webm')?.kind, 'video')
  assert.equal(classifyMedia('doc.pdf')?.kind, 'pdf')
  assert.equal(classifyMedia('Makefile'), null)
  assert.equal(classifyMedia('code.ts'), null)
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('models: provider fallback, labels, defaults and resolution', () => {
  assert.equal(fallbackAiProvider('free'), 'grok')
  assert.equal(fallbackAiProvider(null), 'grok')
  assert.equal(fallbackAiProvider('claude'), 'claude')
  assert.equal(hasConnectedAi([{ connected: false }, { connected: true }]), true)
  assert.equal(hasConnectedAi([]), false)
  const accounts = [
    { provider: 'grok', connected: false },
    { provider: 'claude', connected: true }
  ]
  assert.equal(resolveAiProvider({ aiProvider: 'grok' }, accounts), 'claude')
  assert.equal(resolveAiProvider({ aiProvider: 'claude' }, accounts), 'claude')
  const settings = { aiModels: { claude: 'custom-model' }, aiEndpoints: [{ id: 'custom-x', label: 'X', baseUrl: 'http://x', defaultModel: 'x-1' }] } as never
  assert.deepEqual(listedProviderIds(settings), ['grok', 'chatgpt', 'claude', 'custom-x'])
  assert.equal(defaultModelFor('claude', settings), 'custom-model')
  assert.equal(defaultModelFor('custom-x', settings), 'x-1')
  assert.equal(defaultModelFor('grok', null), 'grok-4.7')
  assert.equal(providerLabel('chatgpt'), 'ChatGPT')
  assert.equal(providerLabel('custom-x', [{ id: 'custom-x', label: 'X' } as never]), 'X')
  assert.equal(providerLabel('unknown'), 'unknown')
})

test('themes: accents, icon maps and sanitizers', () => {
  assert.deepEqual(THEME_PACKS.map((p) => p.id), ['classic', 'colored', 'spacex'])
  assert.deepEqual(resolveAccent('custom', 'dark', '#123456'), { accent: '#123456', accent2: '#123456' })
  assert.notEqual(resolveAccent('custom', 'dark', 'bad').accent, 'bad')
  assert.notEqual(resolveAccent('blue', 'dark').accent, resolveAccent('blue', 'light').accent)
  assert.equal(iconColorMap('classic', 'mono'), null)
  assert.equal(iconColorMap('classic', 'color')?.brand, undefined)
  assert.notEqual(iconColorMap('classic', 'color', 'light')?.home, iconColorMap('classic', 'color', 'dark')?.home)
  assert.ok(iconColorMap('spacex', 'color'))
  assert.equal(sanitizeThemePack('colored'), 'colored')
  assert.equal(sanitizeThemePack('spoon'), 'classic')
  assert.equal(sanitizeIconStyle('color'), 'color')
  assert.equal(sanitizeIconStyle(3), 'mono')
  assert.equal(sanitizeAccentId('teal'), 'teal')
  assert.equal(sanitizeAccentCustom('#abcdef'), '#abcdef')
  assert.equal(sanitizeAccentCustom('#abc'), undefined)
})

test('workspaces: colours, keys, clustering, dedupe and sanitising', () => {
  assert.equal(workspaceColor(0), WORKSPACE_COLORS[0])
  assert.equal(workspaceColor(WORKSPACE_COLORS.length + 1), WORKSPACE_COLORS[1])
  assert.equal(workspaceColor(Number.NaN), WORKSPACE_COLORS[0])
  assert.equal(normalizeWorkspaceColor('#ABCDEF'), '#abcdef')
  assert.equal(normalizeWorkspaceColor('red', 2), WORKSPACE_COLORS[2])
  assert.equal(groupKey({ id: 't', workspaceId: 'w' }), 'ws:w')
  assert.equal(groupKey({ id: 't', color: '#AAAAAA' }), 'color:#aaaaaa')
  assert.equal(groupKey({ id: 't' }), 'tab:t')
  const tabs = [
    { id: '1', workspaceId: 'a' },
    { id: '2' },
    { id: '3', workspaceId: 'a' },
    { id: '4', color: '#111111' },
    { id: '5', color: '#111111' }
  ]
  assert.deepEqual(clusterGrouped(tabs).map((t) => t.id), ['1', '3', '2', '4', '5'])
  assert.deepEqual(uniqueRepoPaths([' C:/a ', 'c:/A', '', 'C:/b']), ['C:/a', 'C:/b'])
  const clean = sanitizeWorkspaces([
    { id: 'x', name: ' Name ', repos: ['C:/a', 3, 'C:/a'] },
    { id: '', name: 'no id', repos: ['C:/a'] },
    { id: 'y', name: 'no repos', repos: [] },
    null,
    'junk'
  ])
  assert.deepEqual(clean, [{ id: 'x', name: 'Name', color: WORKSPACE_COLORS[0], repos: ['C:/a'] }])
  assert.deepEqual(sanitizeWorkspaces('nope'), [])
})

test('workspaces: AI analysis parsing drops unknown and duplicate repos', () => {
  const repos = [
    { path: 'D:/x/one', name: 'one' },
    { path: 'D:/x/two', name: 'two' }
  ]
  const parsed = parseWorkspaceAnalysis(
    JSON.stringify({ summary: 's', workspaces: [
      { name: 'A', repos: ['one', 'one', 'ghost'] },
      { name: 'B', repos: ['D:/x/one', 'two'] }
    ] }),
    repos
  )
  const all = parsed.workspaces.flatMap((w) => w.repos)
  assert.equal(new Set(all).size, all.length, 'a repository may appear in at most one workspace')
  assert.ok(!all.includes('ghost'))
  assert.equal(fallbackWorkspaceAnalysis(repos).workspaces.length, 1)
})

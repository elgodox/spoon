import { resolveAccent, sanitizeThemePack } from '../shared/themes.ts'

const accent = resolveAccent('red', 'dark')
if (accent.accent !== '#ff6b5a') throw new Error('mars accent dark')

if (sanitizeThemePack('spacex') !== 'spacex') throw new Error('pack sanitize')
if (sanitizeThemePack('nope') !== 'classic') throw new Error('pack fallback')

const blue = resolveAccent('blue', 'light')
if (blue.accent !== '#0b57d0') throw new Error('blue light accent')

console.log('themes tests ok')

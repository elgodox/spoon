import type { MediaKind } from './types'

const TABLE: Record<string, { kind: MediaKind; mime: string }> = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  '.ico': { kind: 'image', mime: 'image/x-icon' },
  '.svg': { kind: 'image', mime: 'image/svg+xml' },
  '.avif': { kind: 'image', mime: 'image/avif' },
  '.tif': { kind: 'image', mime: 'image/tiff' },
  '.tiff': { kind: 'image', mime: 'image/tiff' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.ogv': { kind: 'video', mime: 'video/ogg' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.flac': { kind: 'audio', mime: 'audio/flac' },
  '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.pdf': { kind: 'pdf', mime: 'application/pdf' }
}

export function classifyMedia(file: string): { kind: MediaKind; mime: string } | null {
  const dot = file.lastIndexOf('.')
  if (dot < 0) return null
  return TABLE[file.slice(dot).toLowerCase()] ?? null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

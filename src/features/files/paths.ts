/** Pure helpers for file paths on the phone and for displaying files. */

import type { FileEntry } from '../../lib/adb'

export const ROOT = '/sdcard'

export const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`

export function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return `/${parts.join('/')}`
}

/** `/sdcard/DCIM/Camera` -> [{name:'sdcard', path:'/sdcard'}, ...]. */
export function breadcrumbs(path: string): { name: string; path: string }[] {
  const parts = path.split('/').filter(Boolean)
  return parts.map((name, i) => ({ name, path: `/${parts.slice(0, i + 1).join('/')}` }))
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export type FileCategory = 'folder' | 'image' | 'video' | 'audio' | 'archive' | 'apk' | 'text' | 'code' | 'other'

const EXTENSIONS: Record<Exclude<FileCategory, 'folder' | 'other'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm', '3gp', 'm4v'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'amr'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'],
  apk: ['apk', 'apks', 'xapk', 'aab'],
  text: ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'rtf', 'log'],
  code: ['json', 'xml', 'html', 'js', 'ts', 'kt', 'java', 'py', 'sh', 'yml', 'yaml', 'toml', 'db', 'sql'],
}

export const extensionOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function categoryOf(entry: FileEntry): FileCategory {
  if (entry.kind === 'dir') return 'folder'
  const ext = extensionOf(entry.name)
  for (const [category, list] of Object.entries(EXTENSIONS)) {
    if (list.includes(ext)) return category as FileCategory
  }
  return 'other'
}

/** Image types a webview can show as-is (and so can be previewed). */
const PREVIEWABLE: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
}

export const previewMime = (name: string): string | null => PREVIEWABLE[extensionOf(name)] ?? null

export type SortKey = 'name' | 'size' | 'modified'

/** Folders first, then by the chosen column. Names compare case-insensitively with numbers in order. */
export function sortEntries(entries: FileEntry[], key: SortKey, ascending: boolean): FileEntry[] {
  const dir = ascending ? 1 : -1
  return [...entries].sort((a, b) => {
    if ((a.kind === 'dir') !== (b.kind === 'dir')) return a.kind === 'dir' ? -1 : 1
    const byName = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    if (key === 'size') return (a.size - b.size) * dir || byName
    if (key === 'modified') return a.modified.localeCompare(b.modified) * dir || byName
    return byName * dir
  })
}

/** Why a name can't be used, or null if it's fine. Mirrors the checks the backend enforces. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'Enter a name'
  if (name === '.' || name === '..') return "A name can't be . or .."
  if (name.includes('/')) return "A name can't contain /"
  return null
}

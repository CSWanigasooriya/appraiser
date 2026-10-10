import {
  File,
  FileArchive,
  FileCode,
  FileText,
  Film,
  Folder,
  Image as ImageIcon,
  Music,
  Package,
  type LucideIcon,
} from 'lucide-react'
import type { FileEntry } from '../../lib/adb'
import { categoryOf, type FileCategory } from './paths'

const ICONS: Record<FileCategory, { icon: LucideIcon; color: string }> = {
  folder: { icon: Folder, color: 'text-amber-500' },
  image: { icon: ImageIcon, color: 'text-emerald-500' },
  video: { icon: Film, color: 'text-violet-500' },
  audio: { icon: Music, color: 'text-pink-500' },
  archive: { icon: FileArchive, color: 'text-orange-500' },
  apk: { icon: Package, color: 'text-green-500' },
  text: { icon: FileText, color: 'text-sky-500' },
  code: { icon: FileCode, color: 'text-cyan-500' },
  other: { icon: File, color: 'text-zinc-400' },
}

export function FileIcon({ entry, size = 18 }: { entry: FileEntry; size?: number }) {
  const { icon: Icon, color } = ICONS[categoryOf(entry)]
  return <Icon size={size} className={`flex-none ${color}`} />
}

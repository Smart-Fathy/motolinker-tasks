import {
  FileText,
  FileType,
  Folder,
  Image as ImageIcon,
  Music,
  Paperclip,
  Presentation,
  Sheet,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '../ui/cx';
import styles from './google.module.css';
import type { FileIcon, Glyph } from './model';

const GLYPHS: Readonly<Record<Glyph, LucideIcon>> = {
  paperclip: Paperclip,
  folder: Folder,
  sheet: Sheet,
  'file-text': FileText,
  presentation: Presentation,
  'file-type': FileType,
  image: ImageIcon,
  video: Video,
  music: Music,
};

/** The small picture in front of a file's name: what it is (a folder, a sheet, a PDF…) and, for the ones that have one, a colour. */
export function FileGlyph({ icon }: { icon: FileIcon }) {
  const Shape = GLYPHS[icon.glyph];
  return (
    <Shape
      size={16}
      aria-hidden="true"
      className={cx(styles['fileGlyph'], styles['tone-' + icon.tone])}
      data-part="fileGlyph"
      data-glyph={icon.glyph}
    />
  );
}

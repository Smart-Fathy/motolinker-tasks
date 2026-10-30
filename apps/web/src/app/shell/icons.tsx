import {
  ArrowLeft,
  BarChart3,
  Bell,
  Bug,
  Calendar,
  Car,
  CarFront,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Contact2,
  Factory,
  FileBadge,
  FileSearch,
  FileSignature,
  HardDrive,
  Home,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Palette,
  PanelLeftClose,
  Send,
  ShieldCheck,
  ShoppingCart,
  Table,
  Trash2,
  Users,
  Video,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { Mode } from '../../lib/theme';

/** The icons the rail and the bottom bar draw, by the names the classic portals gave them (lucide's). */
export const ICONS: Readonly<Record<string, LucideIcon>> = {
  'arrow-left': ArrowLeft,
  'bar-chart-3': BarChart3,
  bell: Bell,
  bug: Bug,
  calendar: Calendar,
  car: Car,
  'car-front': CarFront,
  'clipboard-check': ClipboardCheck,
  'clipboard-list': ClipboardList,
  clock: Clock,
  'contact-2': Contact2,
  factory: Factory,
  'file-badge': FileBadge,
  'file-search': FileSearch,
  'file-signature': FileSignature,
  'hard-drive': HardDrive,
  home: Home,
  inbox: Inbox,
  'kanban-square': KanbanSquare,
  'layout-dashboard': LayoutDashboard,
  'log-out': LogOut,
  mail: Mail,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  'message-square-text': MessageSquareText,
  palette: Palette,
  send: Send,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  table: Table,
  'trash-2': Trash2,
  users: Users,
  video: Video,
  workflow: Workflow,
};

/** The Accounting item's brain: a gradient stroke among monochrome chips, on purpose (the gradient is drawn once, in Shell). */
export function BrainIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="url(#ml-ai-grad)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

export function Icon({ name, size }: { name: string; size?: number }) {
  if (name === 'brain-ai') return <BrainIcon />;
  const Glyph = ICONS[name];
  return Glyph ? <Glyph aria-hidden="true" {...(size ? { size } : {})} /> : null;
}

export { ChevronDown, Menu, PanelLeftClose };

/** The colour-mode button's three glyphs: the moon, the sun and the half-filled disc (the classic portals' own). */
export function ModeIcon({ mode }: { mode: Mode }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (mode === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (mode === 'auto') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

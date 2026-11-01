import {
  AlarmClock,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Box,
  Bug,
  Calendar,
  CalendarPlus,
  Camera,
  Car,
  CarFront,
  Check,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  CircleDot,
  ClipboardList,
  Clock,
  Container,
  Contact2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Factory,
  FileBadge,
  FileSearch,
  FileText,
  FileSignature,
  Filter,
  Hash,
  HardDrive,
  Headphones,
  Home,
  Inbox,
  KanbanSquare,
  Key,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Link,
  List,
  ListPlus,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Navigation2,
  Palette,
  PanelLeftClose,
  Paperclip,
  Pencil,
  PhoneCall,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Rows3,
  Search,
  Send,
  Ship,
  ShieldAlert,
  ShieldCheck,
  Settings2,
  ShoppingCart,
  Shuffle,
  Table,
  Timer,
  Trash2,
  Upload,
  Users,
  Video,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Mode } from '../../lib/theme';

/** The icons the rail and the bottom bar draw, by the names the classic portals gave them (lucide's). */
export const ICONS: Readonly<Record<string, LucideIcon>> = {
  'alarm-clock': AlarmClock,
  'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'bar-chart-3': BarChart3,
  bell: Bell,
  bug: Bug,
  calendar: Calendar,
  'calendar-plus': CalendarPlus,
  camera: Camera,
  car: Car,
  'car-front': CarFront,
  check: Check,
  'check-circle': CheckCircle,
  'check-circle-2': CheckCircle2,
  'chevron-down': ChevronDown,
  'circle-dot': CircleDot,
  'clipboard-check': ClipboardCheck,
  'clipboard-list': ClipboardList,
  clock: Clock,
  container: Container,
  box: Box,
  'contact-2': Contact2,
  download: Download,
  'external-link': ExternalLink,
  eye: Eye,
  'eye-off': EyeOff,
  factory: Factory,
  'file-badge': FileBadge,
  'file-search': FileSearch,
  'file-signature': FileSignature,
  'file-text': FileText,
  filter: Filter,
  'hard-drive': HardDrive,
  hash: Hash,
  headphones: Headphones,
  home: Home,
  inbox: Inbox,
  'kanban-square': KanbanSquare,
  key: Key,
  'key-round': KeyRound,
  'layout-dashboard': LayoutDashboard,
  'layout-grid': LayoutGrid,
  link: Link,
  list: List,
  'list-plus': ListPlus,
  'log-out': LogOut,
  'map-pin': MapPin,
  mail: Mail,
  'message-circle': MessageCircle,
  'message-square': MessageSquare,
  'message-square-text': MessageSquareText,
  'navigation-2': Navigation2,
  palette: Palette,
  paperclip: Paperclip,
  pencil: Pencil,
  'phone-call': PhoneCall,
  plug: Plug,
  plus: Plus,
  radio: Radio,
  'refresh-cw': RefreshCw,
  'rotate-ccw': RotateCcw,
  'rows-3': Rows3,
  search: Search,
  send: Send,
  ship: Ship,
  'shield-alert': ShieldAlert,
  'settings-2': Settings2,
  'shield-check': ShieldCheck,
  'shopping-cart': ShoppingCart,
  shuffle: Shuffle,
  table: Table,
  timer: Timer,
  'trash-2': Trash2,
  upload: Upload,
  users: Users,
  video: Video,
  workflow: Workflow,
  x: X,
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

export function Icon({
  name,
  size,
  className,
}: {
  name: string;
  size?: number;
  /** a screen that draws the icon its own way says so */
  className?: string;
}) {
  if (name === 'brain-ai') return <BrainIcon />;
  const Glyph = ICONS[name];
  return Glyph ? (
    <Glyph aria-hidden="true" {...(size ? { size } : {})} {...(className ? { className } : {})} />
  ) : null;
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

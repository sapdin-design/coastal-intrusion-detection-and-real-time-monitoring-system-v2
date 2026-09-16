import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Anchor,
  BarChart3,
  BellRing,
  ClipboardList,
  Compass,
  Gauge,
  Hexagon,
  LayoutDashboard,
  Layers,
  LifeBuoy,
  PlayCircle,
  Radar,
  Radio,
  Route,
  Satellite,
  Settings,
  ShieldAlert,
  Ship,
  Siren,
  Target,
  Waves,
  type LucideIcon,
} from 'lucide-react';

/**
 * Explicit icon registry.
 *
 * The navigation model in `lib/constants.ts` stores icon *names* so it stays a
 * plain data module with no React import; this map is the single place where those
 * names are bound to components, which also makes the bundler's tree-shaking of
 * lucide-react predictable.
 */
export const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  Radar,
  BellRing,
  ClipboardList,
  Ship,
  Hexagon,
  PlayCircle,
  BarChart3,
  Settings,
  Activity,
  AlertOctagon,
  AlertTriangle,
  Anchor,
  Compass,
  Gauge,
  Layers,
  LifeBuoy,
  Radio,
  Route,
  Satellite,
  ShieldAlert,
  Siren,
  Target,
  Waves,
};

export function Icon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Component = ICONS[name] ?? Activity;
  return <Component className={className} strokeWidth={strokeWidth} />;
}

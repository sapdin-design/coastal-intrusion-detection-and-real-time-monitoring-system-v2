import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Severity } from '@/types';

/** Tailwind-aware class merge — the single helper every component uses. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ────────────────────────────── Formatting ───────────────────────────── */

export const formatNumber = (value: number | null | undefined, digits = 0): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const formatCoord = (value: number | undefined, axis: 'lat' | 'lng'): string => {
  if (value === undefined || value === null || Number.isNaN(value)) return '—';
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(4)}° ${hemi}`;
};

export const formatSpeed = (kmh: number | undefined): string =>
  kmh === undefined || kmh === null ? '—' : `${kmh.toFixed(1)} km/h`;

/**
 * Maritime speed.
 *
 * The data model stores km/h, but a coastal operations console reads in knots —
 * "making 8.4 knots" is what a watch officer says. Shown alongside the km/h value
 * rather than replacing it, so the stored unit is never ambiguous.
 */
export const formatKnots = (kmh: number | undefined): string =>
  kmh === undefined || kmh === null ? '—' : `${(kmh / 1.852).toFixed(1)} kn`;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export const formatHeading = (deg: number | undefined): string => {
  if (deg === undefined || deg === null) return '—';
  return `${Math.round(deg)}° ${COMPASS[Math.round(deg / 22.5) % 16]}`;
};

export const formatDistance = (meters: number | null | undefined): string => {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

/** "just now", "4 min ago", "3 h ago", "2 d ago" — the workhorse of a live feed. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export const formatTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

export const formatDateTime = (iso: string | null | undefined): string =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export const formatUptime = (seconds: number): string => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};

export const formatDuration = (minutes: number | null | undefined): string => {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/* ─────────────────────────── Semantic styling ────────────────────────── */

export const severityClasses: Record<Severity, string> = {
  LOW: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  HIGH: 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200',
  CRITICAL: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
};

export const severityDot: Record<Severity, string> = {
  LOW: 'bg-slate-400',
  MEDIUM: 'bg-amber-500',
  HIGH: 'bg-orange-500',
  CRITICAL: 'bg-rose-600',
};

export const vesselStatusClasses: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  WARNING: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  INTRUSION: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  OFFLINE: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
};

export const alertStatusClasses: Record<string, string> = {
  NEW: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  ACKNOWLEDGED: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
};

export const incidentStatusClasses: Record<string, string> = {
  OPEN: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  ACKNOWLEDGED: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200',
  INVESTIGATING: 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200',
};

/** Hex colours consumed by Recharts and by the Leaflet marker builder. */
export const severityHex: Record<Severity, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#f59e0b',
  HIGH: '#f97316',
  CRITICAL: '#e11d48',
};

export const vesselStatusHex: Record<string, string> = {
  ACTIVE: '#059669',
  WARNING: '#d97706',
  INTRUSION: '#dc2626',
  OFFLINE: '#64748b',
};

export const zoneSeverityHex: Record<Severity, string> = {
  LOW: '#38bdf8',
  MEDIUM: '#fbbf24',
  HIGH: '#fb923c',
  CRITICAL: '#f43f5e',
};

export const CHART_COLORS = ['#1d5a92', '#0d9488', '#7c3aed', '#f59e0b', '#e11d48', '#64748b'];

/* ────────────────────────────── Exporting ────────────────────────────── */

/** Downloads an in-memory object as a file — used by the export buttons. */
export function downloadFile(filename: string, content: string, mime = 'application/json'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))].join('\n');
}

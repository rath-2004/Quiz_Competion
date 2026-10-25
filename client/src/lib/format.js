import { useEffect, useState } from 'react';

export const YEAR_OPTIONS = [
  { value: 1, label: '1st year' },
  { value: 2, label: '2nd year' },
  { value: 3, label: '3rd year' },
  { value: 4, label: '4th year' },
  { value: 5, label: '5th year' },
];

export const yearLabel = (y) => YEAR_OPTIONS.find((o) => o.value === y)?.label ?? (y ? `Year ${y}` : '—');

export function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** "02:05:09" style clock, with a day prefix when far away. */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = h || days ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return days ? `${days}d ${clock}` : clock;
}

export function formatScore(n) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

export const STATE_LABELS = { draft: 'Draft', upcoming: 'Upcoming', live: 'Live', ended: 'Ended' };

/** Milliseconds to add to Date.now() to get the server's clock. */
export function clockOffset(serverNow) {
  return serverNow ? new Date(serverNow).getTime() - Date.now() : 0;
}

/** Re-renders every `intervalMs` and returns the current server-adjusted time in ms. */
export function useNow(offset = 0, intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const timer = setInterval(() => setNow(Date.now() + offset), intervalMs);
    return () => clearInterval(timer);
  }, [offset, intervalMs]);
  return now;
}

/** Competition state as of `now`, so the UI flips from upcoming to live without a reload. */
export function liveState(competition, now) {
  if (competition.state === 'draft') return 'draft';
  if (now < new Date(competition.startsAt).getTime()) return 'upcoming';
  if (now < new Date(competition.endsAt).getTime()) return 'live';
  return 'ended';
}

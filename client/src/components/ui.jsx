import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// ---- Data loading ----------------------------------------------------------------------------------------

/** Loads `path` and re-loads when it changes. `reload()` refetches without clearing current data. */
export function useApi(path, { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    api(path, { signal: controller.signal })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
      });
    return () => controller.abort();
  }, [path, tick]);

  useEffect(() => {
    if (!interval) return undefined;
    const id = setInterval(reload, interval);
    return () => clearInterval(id);
  }, [interval, reload]);

  return { ...state, reload };
}

// ---- Toasts ----------------------------------------------------------------------------------------------

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---- Building blocks -------------------------------------------------------------------------------------

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error">
      <span>{error.message || String(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Badge({ tone = 'gray', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, className = '' }) {
  return (
    <label className={`field ${error ? 'field-invalid' : ''} ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="pagination muted">{total} total</div>;
  return (
    <div className="pagination">
      <span className="muted">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        ‹ Prev
      </button>
      <span>
        Page {page} / {pages}
      </span>
      <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        Next ›
      </button>
    </div>
  );
}

/** Debounces a value — used so search boxes don't fire a request per keystroke. */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---- Formatting ------------------------------------------------------------------------------------------

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });

export const formatDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '—');
export const formatDate = (d) => (d ? dateFmt.format(new Date(d)) : '—');

export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return '—';
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function formatScore(n) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

export function phaseOf(c, now = Date.now()) {
  if (c.status === 'draft') return 'draft';
  if (now < new Date(c.start_time).getTime()) return 'upcoming';
  if (now > new Date(c.end_time).getTime()) return 'ended';
  return 'live';
}

export function PhaseBadge({ competition }) {
  const phase = phaseOf(competition);
  const map = { draft: ['gray', 'Draft'], upcoming: ['blue', 'Upcoming'], live: ['green', 'Live'], ended: ['slate', 'Ended'] };
  const [tone, label] = map[phase];
  return (
    <Badge tone={tone}>
      {phase === 'live' && <span className="dot-live" />}
      {label}
    </Badge>
  );
}

/** Re-renders every second and returns the current time. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Converts an ISO string to the value format of <input type="datetime-local"> in local time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

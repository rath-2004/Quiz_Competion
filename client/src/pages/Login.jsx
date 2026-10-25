import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Field } from '../components/ui.jsx';

export function AuthCard({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <div className="auth-card card">
        <Link to="/" className="brand">
          <span className="brand-mark">Q</span>
          <span>QuizArena</span>
        </Link>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(form.email, form.password);
      const from = location.state?.from;
      const home = u.role === 'admin' ? '/admin' : '/dashboard';
      navigate(from && from.startsWith(u.role === 'admin' ? '/admin' : '/') ? from : home, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Welcome back" subtitle="Log in to join your competitions.">
      <form onSubmit={onSubmit} className="stack">
        <ErrorBox error={error} />
        <Field label="Email">
          <input
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="muted center">
          New here? <Link to="/register">Create a student account</Link>
        </p>
      </form>
    </AuthCard>
  );
}

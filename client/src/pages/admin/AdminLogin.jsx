import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ErrorBox, Field } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAdmin } from '../../lib/auth.jsx';

export default function AdminLogin() {
  const { user, setUser } = useAdmin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/admin" replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/auth/admin/login', { email, password });
      setUser(res.admin);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page-admin">
      <form className="card auth-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="brand-mark">Q</span>
          <span className="brand-text">Quiz Admin</span>
        </div>
        <h1>Organiser login</h1>
        <ErrorBox error={error} />
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="auth-switch">
          <Link to="/">← Student site</Link>
        </p>
      </form>
    </div>
  );
}

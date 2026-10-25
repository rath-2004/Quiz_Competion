import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorBox, Field, Loading } from '../components/ui.jsx';
import { api, fieldErrors, useFetch } from '../lib/api.js';
import { useStudent } from '../lib/auth.jsx';
import { YEAR_OPTIONS } from '../lib/format.js';

const EMPTY = { name: '', registerNo: '', email: '', phone: '', departmentId: '', yearOfStudy: '', password: '', confirm: '' };

export default function Register() {
  const { user, setUser } = useStudent();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const departments = useFetch('/departments');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={params.get('next') || '/dashboard'} replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { confirm: _confirm, ...body } = form;
      const res = await api.post('/auth/student/register', body);
      setUser(res.student);
      navigate(params.get('next') || '/dashboard', { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (departments.loading && !departments.data) return <Loading />;
  const deptList = departments.data?.departments ?? [];

  return (
    <div className="auth-page">
      <form className="card auth-card auth-card-wide" onSubmit={onSubmit} noValidate>
        <h1>Student registration</h1>
        <p className="muted">Fill in your details exactly as in your college records. Results and certificates use this information.</p>
        <ErrorBox error={departments.error} onRetry={departments.reload} />
        {error && !Object.keys(errors).length && <ErrorBox error={error} />}
        {deptList.length === 0 && !departments.error && (
          <div className="alert alert-warning">Registration is not open yet — the organisers have not added departments.</div>
        )}

        <div className="form-grid">
          <Field label="Full name" error={errors.name} htmlFor="name">
            <input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
          </Field>
          <Field label="Register number" error={errors.registerNo} htmlFor="registerNo">
            <input id="registerNo" value={form.registerNo} onChange={set('registerNo')} autoComplete="off" required />
          </Field>
          <Field label="Email" error={errors.email} htmlFor="email">
            <input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </Field>
          <Field label="Phone number" error={errors.phone} htmlFor="phone">
            <input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" required />
          </Field>
          <Field label="Department" error={errors.departmentId} htmlFor="departmentId">
            <select id="departmentId" value={form.departmentId} onChange={set('departmentId')} required>
              <option value="">Select department</option>
              {deptList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Year of study" error={errors.yearOfStudy} htmlFor="yearOfStudy">
            <select id="yearOfStudy" value={form.yearOfStudy} onChange={set('yearOfStudy')} required>
              <option value="">Select year</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y.value} value={y.value}>
                  {y.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Password" error={errors.password} hint="At least 8 characters" htmlFor="password">
            <input id="password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
          </Field>
          <Field label="Confirm password" error={errors.confirm} htmlFor="confirm">
            <input id="confirm" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
          </Field>
        </div>

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || deptList.length === 0}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
        <p className="auth-switch">
          Already registered? <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : ''}`}>Log in</Link>
        </p>
      </form>
    </div>
  );
}

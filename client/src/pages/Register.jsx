import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Field } from '../components/ui.jsx';
import { AuthCard } from './Login.jsx';

const EMPTY = {
  name: '',
  email: '',
  phone: '',
  college: '',
  department: '',
  year_of_study: '',
  roll_number: '',
  password: '',
  confirm: '',
};

/** Shared by registration, the profile page and the admin "add / edit student" forms. */
export function StudentFields({ form, setForm, errors = {}, withEmail = true, withPassword = false }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="grid-2">
      <Field label="Full name" error={errors.name} className="span-2">
        <input required value={form.name} onChange={set('name')} autoComplete="name" />
      </Field>
      {withEmail && (
        <Field label="Email" error={errors.email}>
          <input type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
        </Field>
      )}
      <Field label="Phone" error={errors.phone}>
        <input type="tel" value={form.phone ?? ''} onChange={set('phone')} autoComplete="tel" placeholder="Optional" />
      </Field>
      <Field label="College / Institution" error={errors.college} className="span-2">
        <input required value={form.college} onChange={set('college')} autoComplete="organization" />
      </Field>
      <Field label="Roll / Registration number" error={errors.roll_number}>
        <input required value={form.roll_number} onChange={set('roll_number')} />
      </Field>
      <Field label="Department / Branch" error={errors.department}>
        <input value={form.department ?? ''} onChange={set('department')} placeholder="e.g. CSE" />
      </Field>
      <Field label="Year of study" error={errors.year_of_study}>
        <select value={form.year_of_study ?? ''} onChange={set('year_of_study')}>
          <option value="">—</option>
          {[1, 2, 3, 4, 5, 6].map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </Field>
      {withPassword && (
        <>
          <Field label="Password" error={errors.password} hint="At least 8 characters">
            <input type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" error={errors.confirm}>
            <input type="password" required value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </Field>
        </>
      )}
    </div>
  );
}

export function toStudentPayload(form) {
  return {
    name: form.name,
    email: form.email,
    phone: form.phone || null,
    college: form.college,
    department: form.department || null,
    year_of_study: form.year_of_study ? Number(form.year_of_study) : null,
    roll_number: form.roll_number,
    ...(form.password ? { password: form.password } : {}),
  };
}

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/dashboard'} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await register(toStudentPayload(form));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Student registration" subtitle="Use your official college details — they appear on results and certificates.">
      <form onSubmit={onSubmit} className="stack">
        <ErrorBox error={error} />
        <StudentFields form={form} setForm={setForm} errors={errors} withPassword />
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="muted center">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </AuthCard>
  );
}

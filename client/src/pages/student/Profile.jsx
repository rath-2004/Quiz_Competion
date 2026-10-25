import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { ErrorBox, Field, useToast } from '../../components/ui.jsx';
import { StudentFields, toStudentPayload } from '../Register.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const notify = useToast();
  const [form, setForm] = useState({ ...user, phone: user.phone ?? '', department: user.department ?? '', year_of_study: user.year_of_study ?? '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState(null);

  async function saveProfile(e) {
    e.preventDefault();
    setError(null);
    setErrors({});
    try {
      const { email: _e, ...payload } = toStudentPayload(form);
      const d = await api('/auth/me', { method: 'PUT', body: payload });
      setUser(d.user);
      notify('Profile updated');
    } catch (err) {
      setError(err);
      setErrors(err.details || {});
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPwError(null);
    if (pw.newPassword !== pw.confirm) return setPwError(new Error('New passwords do not match'));
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: pw.currentPassword, newPassword: pw.newPassword } });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      notify('Password changed. Other devices have been signed out.');
    } catch (err) {
      setPwError(err);
    }
  }

  return (
    <div className="stack-lg narrow">
      <h1>My profile</h1>
      <form className="card stack" onSubmit={saveProfile}>
        <div className="row between">
          <h2>Details</h2>
          <span className="muted">{user.email}</span>
        </div>
        <ErrorBox error={error} />
        <StudentFields form={form} setForm={setForm} errors={errors} withEmail={false} />
        <div>
          <button type="submit" className="btn btn-primary">
            Save changes
          </button>
        </div>
      </form>
      <form className="card stack" onSubmit={changePassword}>
        <h2>Change password</h2>
        <ErrorBox error={pwError} />
        <div className="grid-2">
          <Field label="Current password" className="span-2">
            <input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input type="password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <input type="password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        <div>
          <button type="submit" className="btn">
            Update password
          </button>
        </div>
      </form>
    </div>
  );
}

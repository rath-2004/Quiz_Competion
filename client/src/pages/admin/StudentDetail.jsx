import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { Badge, Empty, ErrorBox, Field, Modal, Spinner, formatDateTime, formatDuration, formatScore, useApi, useToast } from '../../components/ui.jsx';
import { StudentFormModal } from './Students.jsx';

export default function AdminStudentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const { data, error, loading, reload } = useApi(`/admin/students/${id}`);
  const [editing, setEditing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const s = data.student;

  async function toggle() {
    try {
      await api(`/admin/students/${id}/status`, { method: 'PATCH', body: { is_active: !s.is_active } });
      notify(s.is_active ? 'Student blocked and signed out' : 'Student unblocked');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  async function resetPassword() {
    try {
      await api(`/admin/students/${id}/reset-password`, { method: 'POST', body: { password: newPassword } });
      notify('Password reset. Share the new password with the student.');
      setResetting(false);
      setNewPassword('');
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  async function remove() {
    if (!window.confirm(`Permanently delete ${s.name} and all their registrations and results?`)) return;
    try {
      await api(`/admin/students/${id}`, { method: 'DELETE' });
      notify('Student deleted');
      navigate('/admin/students');
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  return (
    <div className="stack-lg">
      <Link to="/admin/students" className="muted">
        ← Students
      </Link>
      <div className="page-head">
        <div>
          <div className="row gap-sm">
            <h1>{s.name}</h1>
            {s.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Blocked</Badge>}
          </div>
          <p className="muted">
            {s.email} · joined {formatDateTime(s.created_at)}
          </p>
        </div>
        <div className="row gap-sm wrap">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="btn" onClick={() => setResetting(true)}>
            Reset password
          </button>
          <button type="button" className={`btn ${s.is_active ? 'btn-danger-ghost' : ''}`} onClick={toggle}>
            {s.is_active ? 'Block' : 'Unblock'}
          </button>
          <button type="button" className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      <section className="card">
        <dl className="kv kv-wide">
          <dt>College</dt>
          <dd>{s.college}</dd>
          <dt>Roll / Reg. no.</dt>
          <dd>{s.roll_number}</dd>
          <dt>Department</dt>
          <dd>{s.department || '—'}</dd>
          <dt>Year</dt>
          <dd>{s.year_of_study || '—'}</dd>
          <dt>Phone</dt>
          <dd>{s.phone || '—'}</dd>
        </dl>
      </section>

      <section className="card stack">
        <h2>Competitions</h2>
        {data.competitions.length === 0 ? (
          <Empty title="Not registered for any competition" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Competition</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th className="num">Score</th>
                  <th className="num">C / W / U</th>
                  <th className="num">Tab sw.</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {data.competitions.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/competitions/${c.id}`}>{c.title}</Link>
                      <div className="muted small">{formatDateTime(c.start_time)}</div>
                    </td>
                    <td className="small">{formatDateTime(c.registered_at)}</td>
                    <td>
                      {c.status === 'submitted' ? (
                        <Badge tone="green">Submitted{c.auto_submitted ? ' (auto)' : ''}</Badge>
                      ) : c.status === 'in_progress' ? (
                        <Badge tone="amber">In progress</Badge>
                      ) : (
                        <Badge>Not started</Badge>
                      )}
                    </td>
                    <td className="num strong">{c.status === 'submitted' ? `${formatScore(c.score)} / ${formatScore(c.max_score)}` : '—'}</td>
                    <td className="num small">{c.status === 'submitted' ? `${c.correct_count} / ${c.wrong_count} / ${c.unanswered_count}` : '—'}</td>
                    <td className="num">{c.status ? c.tab_switches : '—'}</td>
                    <td className="num small">{c.submitted_at ? formatDuration((new Date(c.submitted_at) - new Date(c.started_at)) / 1000) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <StudentFormModal
          student={s}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {resetting && (
        <Modal
          title={`Reset password for ${s.name}`}
          onClose={() => setResetting(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setResetting(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={newPassword.length < 8} onClick={resetPassword}>
                Reset password
              </button>
            </>
          }
        >
          <Field label="New password" hint="At least 8 characters. The student is signed out of all devices.">
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  );
}

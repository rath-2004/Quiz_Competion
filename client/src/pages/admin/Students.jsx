import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AttemptBadge, ConfirmDialog, EmptyState, ErrorBox, Field, Loading, Modal, Pagination, useToast } from '../../components/ui.jsx';
import { api, fieldErrors, queryString, useFetch } from '../../lib/api.js';
import { formatDateTime, formatScore, YEAR_OPTIONS, yearLabel } from '../../lib/format.js';

function StudentModal({ studentId, departments, onClose, onChanged }) {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch(`/admin/students/${studentId}`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [tempPassword, setTempPassword] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'delete' | 'reset'
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const s = data?.student;

  const run = async (fn) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setErrors(fieldErrors(err));
      setActionError(err);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const toggleBlock = () =>
    run(async () => {
      await api.post(`/admin/students/${s.id}/block`, { blocked: !s.isBlocked });
      toast(s.isBlocked ? 'Student unblocked' : 'Student blocked');
      reload();
      onChanged();
    });

  const resetPassword = () =>
    run(async () => {
      const res = await api.post(`/admin/students/${s.id}/reset-password`);
      setTempPassword(res.temporaryPassword);
    });

  const remove = () =>
    run(async () => {
      await api.del(`/admin/students/${s.id}`);
      toast('Student deleted');
      onChanged();
      onClose();
    });

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await api.put(`/admin/students/${s.id}`, form);
      toast('Student details updated');
      setEditing(false);
      reload();
      onChanged();
    });
  };

  const startEdit = () => {
    setForm({
      name: s.name,
      email: s.email,
      registerNo: s.registerNo,
      phone: s.phone,
      departmentId: String(s.departmentId),
      yearOfStudy: String(s.yearOfStudy),
    });
    setErrors({});
    setEditing(true);
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal title={s ? s.name : 'Student'} onClose={onClose} wide>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <div className="stack">
          <ErrorBox error={actionError} />
          {tempPassword && (
            <div className="alert alert-success">
              <div>
                New temporary password: <code className="temp-password">{tempPassword}</code>
                <p className="small">Share it with the student privately. It will not be shown again.</p>
              </div>
            </div>
          )}

          {editing ? (
            <form onSubmit={save} className="stack" noValidate>
              <div className="form-grid">
                <Field label="Name" error={errors.name}>
                  <input value={form.name} onChange={set('name')} />
                </Field>
                <Field label="Register number" error={errors.registerNo}>
                  <input value={form.registerNo} onChange={set('registerNo')} />
                </Field>
                <Field label="Email" error={errors.email}>
                  <input type="email" value={form.email} onChange={set('email')} />
                </Field>
                <Field label="Phone" error={errors.phone}>
                  <input value={form.phone} onChange={set('phone')} />
                </Field>
                <Field label="Department" error={errors.departmentId}>
                  <select value={form.departmentId} onChange={set('departmentId')}>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Year" error={errors.yearOfStudy}>
                  <select value={form.yearOfStudy} onChange={set('yearOfStudy')}>
                    {YEAR_OPTIONS.map((y) => (
                      <option key={y.value} value={y.value}>
                        {y.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save changes
                </button>
              </div>
            </form>
          ) : (
            <>
              <dl className="detail-list">
                <div>
                  <dt>Register number</dt>
                  <dd>{s.registerNo}</dd>
                </div>
                <div>
                  <dt>Department</dt>
                  <dd>{s.department}</dd>
                </div>
                <div>
                  <dt>Year</dt>
                  <dd>{yearLabel(s.yearOfStudy)}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${s.email}`}>{s.email}</a>
                  </dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${s.phone}`}>{s.phone}</a>
                  </dd>
                </div>
                <div>
                  <dt>Registered</dt>
                  <dd>{formatDateTime(s.createdAt)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{s.isBlocked ? <span className="badge badge-danger">Blocked</span> : <span className="badge badge-success">Active</span>}</dd>
                </div>
              </dl>
              <div className="action-row">
                <button type="button" className="btn" onClick={startEdit}>
                  Edit details
                </button>
                <button type="button" className="btn" onClick={() => setConfirm('reset')} disabled={busy}>
                  Reset password
                </button>
                <button type="button" className="btn" onClick={toggleBlock} disabled={busy}>
                  {s.isBlocked ? 'Unblock' : 'Block'}
                </button>
                <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirm('delete')} disabled={busy}>
                  Delete student
                </button>
              </div>
            </>
          )}

          <h3>Competitions</h3>
          {data.competitions.length === 0 ? (
            <p className="muted">Not registered for any competition yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Competition</th>
                    <th>Status</th>
                    <th className="num">Score</th>
                    <th className="num">Tab switches</th>
                  </tr>
                </thead>
                <tbody>
                  {data.competitions.map((c) => (
                    <tr key={c.competitionId}>
                      <td>{c.title}</td>
                      <td>
                        <AttemptBadge status={c.status} />
                      </td>
                      <td className="num">{c.score !== null ? `${formatScore(c.score)} / ${formatScore(c.maxScore)}` : '—'}</td>
                      <td className="num">{c.tabSwitches ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirm === 'reset' && (
        <ConfirmDialog
          title="Reset password?"
          message={<p>A new temporary password will be generated. The student&apos;s old password will stop working.</p>}
          confirmLabel="Reset password"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={resetPassword}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmDialog
          title="Delete this student?"
          message={<p>This permanently deletes {s.name}&apos;s account, registrations and all quiz results.</p>}
          confirmLabel="Delete permanently"
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={remove}
        />
      )}
    </Modal>
  );
}

export default function Students() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const departments = useFetch('/admin/departments');
  const [selected, setSelected] = useState(null);

  const filters = {
    search: params.get('search') ?? '',
    departmentId: params.get('departmentId') ?? '',
    year: params.get('year') ?? '',
    status: params.get('status') ?? '',
  };
  const page = Number(params.get('page')) || 1;
  const { data, error, loading, reload } = useFetch(`/admin/students${queryString({ ...filters, page, pageSize: 50 })}`);

  const update = (changes) => {
    // Any filter change goes back to page 1; page 1 itself is left out of the URL.
    const next = { ...filters, page: 1, ...changes };
    const clean = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== '' && !(k === 'page' && Number(v) === 1)));
    setParams(clean, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== filters.search) update({ search });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const deptList = departments.data?.departments ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Students</h1>
        <a className="btn" href={`/api/admin/students/export.csv${queryString({ ...filters })}`}>
          Export to Excel (CSV)
        </a>
      </div>

      <div className="toolbar">
        <div className="filters">
          <input
            type="search"
            placeholder="Search name, register no, email, phone"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students"
          />
          <select value={filters.departmentId} onChange={(e) => update({ departmentId: e.target.value })} aria-label="Department">
            <option value="">All departments</option>
            {deptList.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select value={filters.year} onChange={(e) => update({ year: e.target.value })} aria-label="Year">
            <option value="">All years</option>
            {YEAR_OPTIONS.map((y) => (
              <option key={y.value} value={y.value}>
                {y.label}
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        {data && <span className="muted">{data.total} student(s)</span>}
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No students found">Students appear here as soon as they register on the student site.</EmptyState>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Register No</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Year</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Registered</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} onClick={() => setSelected(s.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSelected(s.id)}>
                    <td>
                      <strong>{s.registerNo}</strong>
                    </td>
                    <td>
                      {s.name} {s.isBlocked && <span className="badge badge-danger">Blocked</span>}
                    </td>
                    <td>{s.department}</td>
                    <td>{yearLabel(s.yearOfStudy)}</td>
                    <td className="small">{s.email}</td>
                    <td className="small">{s.phone}</td>
                    <td className="small">{formatDateTime(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => update({ page: p })} />
        </div>
      )}

      {selected && <StudentModal studentId={selected} departments={deptList} onClose={() => setSelected(null)} onChanged={reload} />}
    </>
  );
}

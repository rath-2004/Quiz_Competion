import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog, EmptyState, ErrorBox, Field, Loading, Modal, useToast } from '../../components/ui.jsx';
import { api, fieldErrors, useFetch } from '../../lib/api.js';

function DepartmentModal({ department, onClose, onSaved }) {
  const [name, setName] = useState(department?.name ?? '');
  const [code, setCode] = useState(department?.code ?? '');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (department) await api.put(`/admin/departments/${department.id}`, { name, code });
      else await api.post('/admin/departments', { name, code });
      onSaved(department ? 'Department updated' : 'Department added');
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={department ? 'Edit department' : 'Add department'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="department-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="department-form" onSubmit={save} className="stack" noValidate>
        {!Object.keys(errors).length && <ErrorBox error={error} />}
        <Field label="Department name" error={errors.name} htmlFor="d-name">
          <input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Science and Engineering" />
        </Field>
        <Field label="Short code" error={errors.code} hint="Shown next to the name, e.g. CSE" htmlFor="d-code">
          <input id="d-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="CSE" />
        </Field>
      </form>
    </Modal>
  );
}

export default function Departments() {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch('/admin/departments');
  const [editing, setEditing] = useState(null); // null | 'new' | department
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/departments/${deleting.id}`);
      toast('Department deleted');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Departments</h1>
          <p className="muted">Students choose one of these when they register.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add department
        </button>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : data.departments.length === 0 ? (
        <EmptyState title="No departments yet">Add your college&apos;s departments so students can register.</EmptyState>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Code</th>
                  <th className="num">Students</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.departments.map((d) => (
                  <tr key={d.id}>
                    <td>{d.name}</td>
                    <td>
                      <span className="badge badge-neutral">{d.code}</span>
                    </td>
                    <td className="num">
                      <Link to={`/admin/students?departmentId=${d.id}`}>{d.students}</Link>
                    </td>
                    <td className="row-actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(d)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost danger-text"
                        onClick={() => setDeleting(d)}
                        disabled={d.students > 0}
                        title={d.students > 0 ? 'Departments with students cannot be deleted' : undefined}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && (
        <DepartmentModal
          department={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            toast(message);
            setEditing(null);
            reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete department?"
          message={<p>{deleting.name} will be removed from the registration form.</p>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

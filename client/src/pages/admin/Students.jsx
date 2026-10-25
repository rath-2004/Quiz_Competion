import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { CsvImportModal } from '../../components/CsvImport.jsx';
import { Badge, Empty, ErrorBox, Field, Modal, Pagination, Spinner, formatDate, useApi, useDebounced, useToast } from '../../components/ui.jsx';
import { StudentFields, toStudentPayload } from '../Register.jsx';

const STUDENT_TEMPLATE = [
  'name,email,phone,college,department,year,roll_number,password',
  'Aarav Sharma,aarav.sharma@example.com,9876543210,Government Engineering College,CSE,3,GEC2023CS001,',
  'Priya Nair,priya.nair@example.com,9876500000,St. Joseph\'s College,Physics,2,SJC22PH014,OwnPassword1',
].join('\n');

export function StudentFormModal({ student, onClose, onSaved }) {
  const notify = useToast();
  const [form, setForm] = useState(
    student
      ? { ...student, phone: student.phone ?? '', department: student.department ?? '', year_of_study: student.year_of_study ?? '', password: '' }
      : { name: '', email: '', phone: '', college: '', department: '', year_of_study: '', roll_number: '', password: '' },
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = toStudentPayload(form);
      const d = student
        ? await api(`/admin/students/${student.id}`, { method: 'PUT', body: { ...body, password: undefined } })
        : await api('/admin/students', { method: 'POST', body });
      notify(student ? 'Student updated' : 'Student added');
      onSaved(d.student);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={student ? 'Edit student' : 'Add student'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="student-form" className="btn btn-primary" disabled={busy}>
            Save
          </button>
        </>
      }
    >
      <form id="student-form" className="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <StudentFields form={form} setForm={setForm} errors={error?.details} />
        {!student && (
          <Field label="Initial password" error={error?.details?.password} hint="Share it with the student; they can change it from their profile.">
            <input required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
        )}
      </form>
    </Modal>
  );
}

export default function AdminStudents() {
  const notify = useToast();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ q: '', college: params.get('college') ?? '', status: '', page: 1 });
  const q = useDebounced(filters.q);
  const query = { q, college: filters.college, status: filters.status };
  const list = useApi(`/admin/students${qs({ ...query, page: filters.page, pageSize: 50 })}`);
  const colleges = useApi('/admin/students/colleges');
  const competitions = useApi('/admin/competitions');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const reload = () => {
    list.reload();
    colleges.reload();
  };

  async function toggle(s) {
    try {
      await api(`/admin/students/${s.id}/status`, { method: 'PATCH', body: { is_active: !s.is_active } });
      notify(s.is_active ? `${s.name} blocked` : `${s.name} unblocked`);
      list.reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p className="muted">{list.data ? `${list.data.total.toLocaleString('en-IN')} matching students` : 'All registered students'}</p>
        </div>
        <div className="row gap-sm wrap">
          <a className="btn" href={`/api/admin/students/export${qs(query)}`}>
            ⬇ Export CSV
          </a>
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            ⬆ Import CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add student
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="filters">
          <input type="search" placeholder="Search name, email, roll no, phone…" value={filters.q} onChange={set('q')} />
          <select value={filters.college} onChange={set('college')}>
            <option value="">All colleges</option>
            {colleges.data?.colleges.map((c) => (
              <option key={c.college} value={c.college}>
                {c.college} ({c.count})
              </option>
            ))}
          </select>
          <select value={filters.status} onChange={set('status')}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? (
          <Spinner />
        ) : list.data?.items.length === 0 ? (
          <Empty title="No students found">Students appear here when they register, or import them from a CSV file.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>College</th>
                  <th>Roll no.</th>
                  <th>Dept / Year</th>
                  <th>Phone</th>
                  <th className="num">Comps</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/admin/students/${s.id}`} className="strong">
                        {s.name}
                      </Link>
                      <div className="muted small">{s.email}</div>
                    </td>
                    <td className="small">{s.college}</td>
                    <td className="small">{s.roll_number}</td>
                    <td className="small">
                      {s.department || '—'}
                      {s.year_of_study ? ` · Y${s.year_of_study}` : ''}
                    </td>
                    <td className="small">{s.phone || '—'}</td>
                    <td className="num small" title="completed / registered">
                      {s.completed} / {s.registrations}
                    </td>
                    <td className="small">{formatDate(s.created_at)}</td>
                    <td>{s.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Blocked</Badge>}</td>
                    <td className="actions">
                      <button type="button" className={`btn btn-sm ${s.is_active ? 'btn-danger-ghost' : ''}`} onClick={() => toggle(s)}>
                        {s.is_active ? 'Block' : 'Unblock'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(page) => setFilters({ ...filters, page })} />}
      </div>

      {adding && (
        <StudentFormModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
          }}
        />
      )}
      {importing && (
        <CsvImportModal
          title="Import students from CSV"
          endpoint="/admin/students/import"
          template={STUDENT_TEMPLATE}
          templateName="students-template.csv"
          help="Columns: name, email, college, roll_number (required); phone, department, year, password (optional). Students already registered with the same email or college + roll number are skipped."
          renderExtra={(extra, setExtra) => (
            <div className="grid-2">
              <Field label="Default password" hint="Used for rows without a password column value (8+ characters).">
                <input
                  value={extra.defaultPassword ?? ''}
                  onChange={(e) => setExtra({ ...extra, defaultPassword: e.target.value || undefined })}
                  placeholder="e.g. Welcome@2026"
                />
              </Field>
              <Field label="Also register them for" hint="Optional">
                <select
                  value={extra.competitionId ?? ''}
                  onChange={(e) => setExtra({ ...extra, competitionId: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">— none —</option>
                  {competitions.data?.competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          onClose={() => setImporting(false)}
          onDone={reload}
        />
      )}
    </div>
  );
}

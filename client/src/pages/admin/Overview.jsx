import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBox, Loading, StatCard, StateBadge } from '../../components/ui.jsx';
import { useFetch } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';

export default function Overview() {
  const { data, error, loading, reload } = useFetch('/admin/stats');

  // Live numbers while a quiz is running.
  useEffect(() => {
    const timer = setInterval(reload, 15000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const { totals, competitions, departments } = data;

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <Link to="/admin/competitions/new" className="btn btn-primary">
          + New competition
        </Link>
      </div>

      <div className="stat-grid">
        <StatCard label="Registered students" value={totals.students} hint={`+${totals.studentsLast24h} in the last 24 hours`} />
        <StatCard label="Taking a quiz right now" value={totals.activeAttempts} tone={totals.activeAttempts ? 'live' : undefined} />
        <StatCard label="Competitions" value={totals.competitions} />
        <StatCard label="Departments" value={totals.departments} />
      </div>

      {totals.departments === 0 && (
        <div className="alert alert-warning">
          Students cannot register until you add departments. <Link to="/admin/departments">Add departments →</Link>
        </div>
      )}

      <section className="card">
        <h2>Current and upcoming competitions</h2>
        {competitions.length === 0 ? (
          <EmptyState title="Nothing scheduled">
            <Link to="/admin/competitions/new" className="btn">
              Create a competition
            </Link>
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Competition</th>
                  <th>Status</th>
                  <th>Starts</th>
                  <th className="num">Registered</th>
                  <th className="num">In progress</th>
                  <th className="num">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {competitions.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/competitions/${c.id}`}>{c.title}</Link>
                    </td>
                    <td>
                      <StateBadge state={c.state} />
                    </td>
                    <td>{formatDateTime(c.startsAt)}</td>
                    <td className="num">{c.registered}</td>
                    <td className="num">{c.inProgress}</td>
                    <td className="num">{c.finished}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Students by department</h2>
        {departments.length === 0 ? (
          <EmptyState title="No departments yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Code</th>
                  <th className="num">Students</th>
                  <th className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link to={`/admin/students?departmentId=${d.id}`}>{d.name}</Link>
                    </td>
                    <td>{d.code}</td>
                    <td className="num">{d.students}</td>
                    <td className="num">{totals.students ? `${Math.round((d.students / totals.students) * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

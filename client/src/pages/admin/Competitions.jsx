import { Link } from 'react-router-dom';
import { Empty, ErrorBox, PhaseBadge, Spinner, formatDateTime, useApi } from '../../components/ui.jsx';

export default function AdminCompetitions() {
  const { data, error, loading, reload } = useApi('/admin/competitions');
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Competitions</h1>
          <p className="muted">Create a competition, assign questions, publish it and track participants live.</p>
        </div>
        <Link to="/admin/competitions/new" className="btn btn-primary">
          + New competition
        </Link>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? (
        <Spinner />
      ) : data?.competitions.length === 0 ? (
        <Empty title="No competitions yet">
          <Link to="/admin/competitions/new">Create your first competition</Link>
        </Empty>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Competition</th>
                <th>Status</th>
                <th>Window</th>
                <th className="num">Duration</th>
                <th className="num">Questions</th>
                <th className="num">Registered</th>
                <th className="num">In progress</th>
                <th className="num">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {data?.competitions.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/admin/competitions/${c.id}`} className="strong">
                      {c.title}
                    </Link>
                  </td>
                  <td>
                    <PhaseBadge competition={c} />
                  </td>
                  <td className="small">
                    {formatDateTime(c.start_time)}
                    <br />
                    <span className="muted">to {formatDateTime(c.end_time)}</span>
                  </td>
                  <td className="num">{c.duration_minutes} min</td>
                  <td className="num">
                    {c.question_count ? `${Math.min(c.question_count, c.assigned_questions)} of ${c.assigned_questions}` : c.assigned_questions}
                    {c.assigned_questions === 0 && <span className="badge badge-red">none</span>}
                  </td>
                  <td className="num">{c.registered_count}</td>
                  <td className="num">{c.in_progress_count}</td>
                  <td className="num">{c.submitted_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

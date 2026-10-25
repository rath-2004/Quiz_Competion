import { Link } from 'react-router-dom';
import { EmptyState, ErrorBox, Loading, StateBadge } from '../../components/ui.jsx';
import { useFetch } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';

export default function CompetitionsAdmin() {
  const { data, error, loading, reload } = useFetch('/admin/competitions');

  return (
    <>
      <div className="page-header">
        <h1>Competitions</h1>
        <Link to="/admin/competitions/new" className="btn btn-primary">
          + New competition
        </Link>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : data.competitions.length === 0 ? (
        <EmptyState title="No competitions yet">
          <Link to="/admin/competitions/new" className="btn btn-primary">
            Create your first competition
          </Link>
        </EmptyState>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th className="num">Duration</th>
                  <th className="num">Questions</th>
                  <th className="num">Registered</th>
                  <th className="num">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.competitions.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/competitions/${c.id}`}>{c.title}</Link>
                    </td>
                    <td>
                      <StateBadge state={c.state} />
                    </td>
                    <td>{formatDateTime(c.startsAt)}</td>
                    <td>{formatDateTime(c.endsAt)}</td>
                    <td className="num">{c.durationMinutes} min</td>
                    <td className="num">{c.stats.questions}</td>
                    <td className="num">{c.stats.registered}</td>
                    <td className="num">{c.stats.finished}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

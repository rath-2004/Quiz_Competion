import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorBox, Loading } from '../components/ui.jsx';
import { useFetch } from '../lib/api.js';
import { formatDuration, formatScore, yearLabel } from '../lib/format.js';

export default function Leaderboard() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch(`/competitions/${id}/leaderboard`);

  if (loading && !data) return <Loading />;

  return (
    <div className="leaderboard-page">
      <Link to={`/competitions/${id}`} className="back-link">
        ← Competition details
      </Link>
      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          <h1>{data.competition.title}</h1>
          <p className="muted">Top 100 · ranked by score, then by time taken</p>
          {data.leaderboard.length === 0 ? (
            <EmptyState title="No results yet" />
          ) : (
            <div className="card table-card">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Year</th>
                    <th className="num">Score</th>
                    <th className="num">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaderboard.map((r, i) => (
                    <tr key={i} className={r.rank <= 3 ? `podium podium-${r.rank}` : ''}>
                      <td>
                        <span className="rank">{r.rank}</span>
                      </td>
                      <td>{r.name}</td>
                      <td>{r.department}</td>
                      <td>{yearLabel(r.yearOfStudy)}</td>
                      <td className="num">
                        {formatScore(r.score)} / {formatScore(r.maxScore)}
                      </td>
                      <td className="num">{formatDuration(r.timeTakenSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

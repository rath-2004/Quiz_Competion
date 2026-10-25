import { Link, useLocation, useParams } from 'react-router-dom';
import { ErrorBox, Spinner, StatCard, formatDateTime, formatDuration, formatScore, useApi } from '../../components/ui.jsx';

const REASONS = {
  time: 'Time was up, so your quiz was submitted automatically.',
  tab: 'Your quiz was submitted automatically because you switched tabs too many times.',
};

export default function Result() {
  const { id } = useParams();
  const location = useLocation();
  const { data, error, loading, reload } = useApi(`/student/competitions/${id}/result`);

  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const r = data;
  const reason = REASONS[location.state?.reason];
  const pct = r.scoreVisible && r.maxScore > 0 ? Math.max(0, Math.round((r.score / r.maxScore) * 100)) : null;

  return (
    <div className="stack-lg narrow">
      <Link to="/dashboard" className="muted">
        ← All competitions
      </Link>
      <div className="card stack center-text">
        <div className="big-emoji">{r.scoreVisible ? (pct >= 70 ? '🏆' : pct >= 40 ? '🎯' : '📘') : '✅'}</div>
        <h1>{r.title}</h1>
        <p className="muted">
          Submitted {formatDateTime(r.submittedAt)}
          {r.startedAt && r.submittedAt && ` · time taken ${formatDuration((new Date(r.submittedAt) - new Date(r.startedAt)) / 1000)}`}
        </p>
        {reason && <div className="alert alert-warn">{reason}</div>}
        {!r.scoreVisible && (
          <div className="alert alert-info">
            Your answers have been recorded. Results will be shown here once the organisers publish them.
          </div>
        )}
        {r.scoreVisible && (
          <>
            <div className="score-ring" style={{ '--pct': pct }}>
              <div>
                <div className="score-big">{formatScore(r.score)}</div>
                <div className="muted small">out of {formatScore(r.maxScore)}</div>
              </div>
            </div>
            {(r.answersVisible || r.rank) && (
              <div className="stats-row stats-row-center">
                {r.answersVisible && (
                  <>
                    <StatCard label="Correct" value={r.correct} tone="green" />
                    <StatCard label="Wrong" value={r.wrong} tone="red" />
                    <StatCard label="Unanswered" value={r.unanswered} />
                  </>
                )}
                {r.rank && <StatCard label="Rank" value={`#${r.rank}`} hint={`of ${r.participants}`} tone="indigo" />}
              </div>
            )}
            {!r.resultsPublished && (
              <p className="muted small">
                {r.answersVisible ? 'Rank and answer review appear' : 'Your rank appears'} after the organisers publish results.
              </p>
            )}
          </>
        )}
      </div>

      {r.review && (
        <section className="stack">
          <h2>Answer review</h2>
          {r.review.map((q) => {
            const status = q.selected === null ? 'skipped' : q.selected === q.correctOption ? 'right' : 'wrong';
            return (
              <div key={q.number} className={`card review review-${status}`}>
                <div className="row between">
                  <strong>Q{q.number}</strong>
                  <span className={`badge ${status === 'right' ? 'badge-green' : status === 'wrong' ? 'badge-red' : 'badge-gray'}`}>
                    {status === 'right' ? 'Correct' : status === 'wrong' ? 'Wrong' : 'Not answered'}
                  </span>
                </div>
                <div className="q-text">{q.text}</div>
                {q.imageUrl && <img className="q-image" src={q.imageUrl} alt="" />}
                <ul className="review-options">
                  {q.options.map((o, i) => (
                    <li
                      key={i}
                      className={i === q.correctOption ? 'opt-correct' : i === q.selected ? 'opt-wrong' : ''}
                    >
                      <span className="opt-key">{String.fromCharCode(65 + i)}</span> {o}
                      {i === q.correctOption && <span className="small"> ✓ correct</span>}
                      {i === q.selected && i !== q.correctOption && <span className="small"> ✗ your answer</span>}
                    </li>
                  ))}
                </ul>
                {q.explanation && <div className="explanation">💡 {q.explanation}</div>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

import { Link, useParams } from 'react-router-dom';
import { ErrorBox, Loading, StatCard } from '../components/ui.jsx';
import { useFetch } from '../lib/api.js';
import { formatDateTime, formatDuration, formatScore } from '../lib/format.js';

const LETTERS = 'ABCDEF';

export default function Result() {
  const { id } = useParams();
  const { data, error, loading, reload } = useFetch(`/student/competitions/${id}/result`);

  if (loading && !data) return <Loading />;
  if (error) {
    return (
      <div className="narrow">
        <ErrorBox error={error} onRetry={reload} />
        <Link to="/dashboard" className="btn">
          Back to my quizzes
        </Link>
      </div>
    );
  }

  const { competition: c, attempt: a, showScore, showReview, review } = data;

  if (a.status === 'in_progress') {
    return (
      <div className="card narrow center">
        <h1>Your quiz is still open</h1>
        <p className="muted">You have not submitted yet.</p>
        <Link to={`/quiz/${c.id}`} className="btn btn-primary">
          Resume quiz
        </Link>
      </div>
    );
  }

  return (
    <div className="result-page">
      <Link to="/dashboard" className="back-link">
        ← My quizzes
      </Link>
      <div className="card result-hero">
        <p className="eyebrow">{c.title}</p>
        <h1>{a.status === 'auto_submitted' ? 'Time was up — your answers were submitted' : 'Quiz submitted'}</h1>
        <p className="muted">Submitted at {formatDateTime(a.submittedAt)}</p>

        {showScore ? (
          <>
            <div className="score-ring">
              <strong>{formatScore(a.score)}</strong>
              <span>out of {formatScore(a.maxScore)}</span>
            </div>
            <div className="stat-grid">
              <StatCard label="Rank" value={a.rank ? `#${a.rank}` : '—'} hint={a.totalParticipants ? `of ${a.totalParticipants} so far` : undefined} />
              <StatCard label="Correct" value={a.correctCount} tone="success" />
              <StatCard label="Wrong" value={a.wrongCount} tone="danger" />
              <StatCard label="Unanswered" value={a.unansweredCount} />
              <StatCard label="Time taken" value={formatDuration(a.timeTakenSeconds)} />
            </div>
            <Link to={`/competitions/${c.id}/leaderboard`} className="btn">
              View leaderboard
            </Link>
          </>
        ) : (
          <div className="alert alert-info">
            {c.resultsVisibility === 'hidden'
              ? 'Your answers have been recorded. Results will be announced by the organisers.'
              : `Your answers have been recorded. Results will be published after the competition closes at ${formatDateTime(c.endsAt)}.`}
          </div>
        )}
      </div>

      {showScore && !showReview && (
        <p className="muted center">Correct answers will be shown here after the competition closes at {formatDateTime(c.endsAt)}.</p>
      )}

      {showReview && review && (
        <section>
          <h2 className="section-title">Answer review</h2>
          {review.map((q, i) => {
            const status = q.selectedOption === null || q.selectedOption === undefined ? 'skipped' : q.selectedOption === q.correctOption ? 'correct' : 'wrong';
            return (
              <div key={q.id} className={`card review-item review-${status}`}>
                <div className="question-meta">
                  <span>Question {i + 1}</span>
                  <span className={`badge badge-${status === 'correct' ? 'success' : status === 'wrong' ? 'danger' : 'neutral'}`}>
                    {status === 'correct' ? 'Correct' : status === 'wrong' ? 'Wrong' : 'Not answered'}
                  </span>
                </div>
                <p className="prewrap review-question">{q.text}</p>
                <ul className="review-options">
                  {q.options.map((text, idx) => (
                    <li
                      key={idx}
                      className={[idx === q.correctOption && 'is-correct', idx === q.selectedOption && idx !== q.correctOption && 'is-wrong']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <span className="option-key">{LETTERS[idx]}</span>
                      <span className="prewrap">{text}</span>
                      {idx === q.selectedOption && <em className="your-answer">Your answer</em>}
                    </li>
                  ))}
                </ul>
                {q.explanation && <p className="explanation prewrap">{q.explanation}</p>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

import { Link, Navigate } from 'react-router-dom';
import CompetitionCard from '../components/CompetitionCard.jsx';
import { EmptyState, ErrorBox, Loading } from '../components/ui.jsx';
import { useFetch } from '../lib/api.js';
import { useStudent } from '../lib/auth.jsx';
import { clockOffset, liveState, useNow } from '../lib/format.js';

export default function Home() {
  const { user } = useStudent();
  const { data, error, loading, reload } = useFetch('/competitions');
  const now = useNow(clockOffset(data?.serverNow));

  if (user) return <Navigate to="/dashboard" replace />;

  const open = (data?.competitions ?? []).filter((c) => liveState(c, now) !== 'ended');

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Inter-department quiz competition</p>
          <h1>Test your knowledge. Compete with the whole college.</h1>
          <p className="hero-text">
            Register with your college register number, join a competition, and take the quiz online when it goes live.
            Results and rankings are published right here.
          </p>
          <div className="hero-actions">
            <Link to="/register" className="btn btn-primary btn-lg">
              Register now
            </Link>
            <Link to="/login" className="btn btn-lg">
              I already have an account
            </Link>
          </div>
        </div>
        <ol className="steps">
          <li>
            <strong>Create your account</strong>
            <span>Name, register number, department, year, email and phone.</span>
          </li>
          <li>
            <strong>Register for a competition</strong>
            <span>Pick from the upcoming quizzes below.</span>
          </li>
          <li>
            <strong>Take the quiz when it starts</strong>
            <span>A timer starts when you begin. Answers save automatically.</span>
          </li>
        </ol>
      </section>

      <section>
        <h2 className="section-title">Competitions</h2>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : open.length === 0 ? (
          <EmptyState title="No competitions are open right now">Check back soon — new quizzes will appear here.</EmptyState>
        ) : (
          <div className="card-grid">
            {open.map((c) => (
              <CompetitionCard key={c.id} competition={c} now={now} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

import { Link } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { Empty, ErrorBox, PhaseBadge, Spinner, formatDateTime, phaseOf, useApi } from '../../components/ui.jsx';

function CompetitionCard({ c }) {
  const phase = phaseOf(c);
  let action;
  if (c.attempt_status === 'submitted') action = { to: `/competitions/${c.id}/result`, label: 'View result' };
  else if (c.attempt_status === 'in_progress' && phase === 'live') action = { to: `/quiz/${c.id}`, label: 'Resume quiz', primary: true };
  else if (phase === 'live' && c.registered) action = { to: `/competitions/${c.id}`, label: 'Start quiz', primary: true };
  else if (phase !== 'ended') action = { to: `/competitions/${c.id}`, label: c.registered ? 'View details' : 'Register', primary: !c.registered };
  else action = { to: `/competitions/${c.id}`, label: 'View details' };

  return (
    <div className="card comp-card">
      <div className="row between">
        <PhaseBadge competition={{ ...c, status: 'published' }} />
        {c.registered && <span className="badge badge-teal">Registered</span>}
      </div>
      <h3>{c.title}</h3>
      {c.description && <p className="muted clamp-2">{c.description}</p>}
      <dl className="meta">
        <div>
          <dt>Starts</dt>
          <dd>{formatDateTime(c.start_time)}</dd>
        </div>
        <div>
          <dt>Ends</dt>
          <dd>{formatDateTime(c.end_time)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{c.duration_minutes} min</dd>
        </div>
        <div>
          <dt>Questions</dt>
          <dd>{c.question_count}</dd>
        </div>
      </dl>
      <Link to={action.to} className={`btn btn-block ${action.primary ? 'btn-primary' : ''}`}>
        {action.label}
      </Link>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi('/student/competitions', { interval: 60000 });

  if (loading && !data) return <Spinner />;
  const all = data?.competitions ?? [];
  const live = all.filter((c) => phaseOf(c) === 'live');
  const upcoming = all.filter((c) => phaseOf(c) === 'upcoming').reverse();
  const past = all.filter((c) => phaseOf(c) === 'ended');

  return (
    <div className="stack-lg">
      <div>
        <h1>Hi, {user?.name?.split(' ')[0]} 👋</h1>
        <p className="muted">Register for competitions below. When a competition is live, start your quiz from here.</p>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <section>
        <h2 className="section-title">Live now</h2>
        {live.length ? (
          <div className="card-grid">{live.map((c) => <CompetitionCard key={c.id} c={c} />)}</div>
        ) : (
          <Empty title="No competitions are live right now">Check the upcoming list and register in advance.</Empty>
        )}
      </section>
      <section>
        <h2 className="section-title">Upcoming</h2>
        {upcoming.length ? (
          <div className="card-grid">{upcoming.map((c) => <CompetitionCard key={c.id} c={c} />)}</div>
        ) : (
          <Empty title="Nothing scheduled yet" />
        )}
      </section>
      {past.length > 0 && (
        <section>
          <h2 className="section-title">Past competitions</h2>
          <div className="card-grid">{past.map((c) => <CompetitionCard key={c.id} c={c} />)}</div>
        </section>
      )}
    </div>
  );
}

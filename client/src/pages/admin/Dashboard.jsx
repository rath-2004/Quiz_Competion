import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Spinner, StatCard, formatDateTime, useApi } from '../../components/ui.jsx';

function SignupChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bar-chart" role="img" aria-label="Student sign-ups over the last 14 days">
      {data.map((d) => (
        <div key={d.day} className="bar-col" title={`${d.day}: ${d.count}`}>
          <span className="bar-value">{d.count || ''}</span>
          <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
          <span className="bar-label">{d.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const { data, error, loading, reload } = useApi('/admin/stats', { interval: 15000 });
  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.totals;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Overview of students, competitions and live activity. Refreshes every 15 seconds.</p>
        </div>
        <Link to="/admin/competitions/new" className="btn btn-primary">
          + New competition
        </Link>
      </div>

      <div className="stats-row">
        <StatCard label="Students" value={t.students.toLocaleString('en-IN')} hint={`${t.colleges} colleges · ${t.blocked_students} blocked`} tone="indigo" />
        <StatCard label="Competitions" value={t.competitions} />
        <StatCard label="Questions in bank" value={t.questions.toLocaleString('en-IN')} />
        <StatCard label="Registrations" value={t.registrations.toLocaleString('en-IN')} />
        <StatCard label="Taking a quiz now" value={t.in_progress} tone="green" />
        <StatCard label="Submissions" value={t.submissions.toLocaleString('en-IN')} />
      </div>

      <section className="card stack">
        <h2>Live competitions</h2>
        {data.live.length === 0 ? (
          <Empty title="No competition is live right now" />
        ) : (
          data.live.map((c) => {
            const done = c.registered_count ? (c.submitted_count / c.registered_count) * 100 : 0;
            const active = c.registered_count ? (c.in_progress_count / c.registered_count) * 100 : 0;
            return (
              <Link key={c.id} to={`/admin/competitions/${c.id}`} className="live-row">
                <div className="row between wrap">
                  <strong>{c.title}</strong>
                  <span className="muted small">ends {formatDateTime(c.end_time)}</span>
                </div>
                <div className="progress">
                  <div className="progress-done" style={{ width: `${done}%` }} />
                  <div className="progress-active" style={{ width: `${active}%` }} />
                </div>
                <div className="row gap wrap small">
                  <span><i className="pal-dot pal-answered" /> {c.submitted_count} submitted</span>
                  <span><i className="pal-dot pal-active" /> {c.in_progress_count} in progress</span>
                  <span className="muted">{c.registered_count} registered</span>
                </div>
              </Link>
            );
          })
        )}
      </section>

      <div className="grid-2 gap-lg">
        <section className="card stack">
          <h2>Sign-ups (last 14 days)</h2>
          <SignupChart data={data.signups} />
        </section>
        <section className="card stack">
          <h2>Top colleges</h2>
          {data.colleges.length === 0 ? (
            <Empty title="No students yet" />
          ) : (
            <table className="table compact">
              <tbody>
                {data.colleges.map((c) => (
                  <tr key={c.college}>
                    <td>
                      <Link to={`/admin/students?college=${encodeURIComponent(c.college)}`}>{c.college}</Link>
                    </td>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card stack">
        <div className="row between">
          <h2>Upcoming</h2>
          <Link to="/admin/competitions">All competitions →</Link>
        </div>
        {data.upcoming.length === 0 ? (
          <Empty title="Nothing scheduled" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Competition</th>
                <th>Starts</th>
                <th>Status</th>
                <th className="num">Registered</th>
              </tr>
            </thead>
            <tbody>
              {data.upcoming.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/admin/competitions/${c.id}`}>{c.title}</Link>
                  </td>
                  <td>{formatDateTime(c.start_time)}</td>
                  <td>{c.status === 'draft' ? <span className="badge badge-gray">Draft</span> : <span className="badge badge-blue">Published</span>}</td>
                  <td className="num">{c.registered_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

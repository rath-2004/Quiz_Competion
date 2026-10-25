import CompetitionCard from '../components/CompetitionCard.jsx';
import { EmptyState, ErrorBox, Loading } from '../components/ui.jsx';
import { useFetch } from '../lib/api.js';
import { useStudent } from '../lib/auth.jsx';
import { clockOffset, liveState, useNow, yearLabel } from '../lib/format.js';

export default function Dashboard() {
  const { user } = useStudent();
  const { data, error, loading, reload } = useFetch('/competitions');
  const now = useNow(clockOffset(data?.serverNow));

  const groups = { live: [], upcoming: [], ended: [] };
  for (const c of data?.competitions ?? []) groups[liveState(c, now)]?.push(c);
  groups.upcoming.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  // Only show past competitions the student actually took part in.
  const past = groups.ended.filter((c) => c.me?.registered);

  return (
    <>
      <section className="profile-banner card">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1>{user.name}</h1>
          <p className="muted">
            {user.registerNo} · {user.department} · {yearLabel(user.yearOfStudy)}
          </p>
        </div>
      </section>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : (
        <>
          {groups.live.length > 0 && (
            <section>
              <h2 className="section-title">Live now</h2>
              <div className="card-grid">
                {groups.live.map((c) => (
                  <CompetitionCard key={c.id} competition={c} now={now} />
                ))}
              </div>
            </section>
          )}
          <section>
            <h2 className="section-title">Upcoming</h2>
            {groups.upcoming.length === 0 ? (
              <EmptyState title="No upcoming competitions">New competitions will appear here as soon as they are announced.</EmptyState>
            ) : (
              <div className="card-grid">
                {groups.upcoming.map((c) => (
                  <CompetitionCard key={c.id} competition={c} now={now} />
                ))}
              </div>
            )}
          </section>
          {past.length > 0 && (
            <section>
              <h2 className="section-title">Past competitions</h2>
              <div className="card-grid">
                {past.map((c) => (
                  <CompetitionCard key={c.id} competition={c} now={now} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

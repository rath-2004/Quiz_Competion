import { Link } from 'react-router-dom';
import { formatCountdown, formatDateTime, liveState } from '../lib/format.js';
import { AttemptBadge, StateBadge } from './ui.jsx';

/** Primary call-to-action for a competition, based on its timing and the student's progress. */
export function competitionAction(c, state) {
  const me = c.me;
  if (!me) {
    if (state === 'ended') return { label: 'View details', to: `/competitions/${c.id}` };
    return { label: 'Register to participate', to: `/competitions/${c.id}`, primary: true };
  }
  if (me.attemptStatus === 'submitted' || me.attemptStatus === 'auto_submitted') {
    return { label: 'View result', to: `/competitions/${c.id}/result` };
  }
  if (me.attemptStatus === 'in_progress' && state === 'live') {
    return { label: 'Resume quiz', to: `/quiz/${c.id}`, primary: true };
  }
  if (state === 'ended') return { label: 'View details', to: `/competitions/${c.id}` };
  if (!me.registered) return { label: 'Register', to: `/competitions/${c.id}`, primary: true };
  if (state === 'live') return { label: 'Start quiz', to: `/competitions/${c.id}`, primary: true };
  return { label: 'View details', to: `/competitions/${c.id}` };
}

export default function CompetitionCard({ competition: c, now }) {
  const state = liveState(c, now);
  const action = competitionAction(c, state);
  const startsIn = new Date(c.startsAt).getTime() - now;
  const endsIn = new Date(c.endsAt).getTime() - now;

  return (
    <article className={`card competition-card ${state === 'live' ? 'is-live' : ''}`}>
      <div className="competition-card-top">
        <StateBadge state={state} />
        {c.me?.registered && <AttemptBadge status={c.me.attemptStatus} />}
      </div>
      <h3>
        <Link to={`/competitions/${c.id}`}>{c.title}</Link>
      </h3>
      {c.description && <p className="muted clamp-2">{c.description}</p>}
      <dl className="meta-list">
        <div>
          <dt>Starts</dt>
          <dd>{formatDateTime(c.startsAt)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{c.durationMinutes} min</dd>
        </div>
        {c.registrationCount !== undefined && (
          <div>
            <dt>Registered</dt>
            <dd>{c.registrationCount}</dd>
          </div>
        )}
      </dl>
      <div className="competition-card-footer">
        {state === 'upcoming' && <span className="countdown-chip">Starts in {formatCountdown(startsIn)}</span>}
        {state === 'live' && <span className="countdown-chip live">Closes in {formatCountdown(endsIn)}</span>}
        <Link to={action.to} className={`btn ${action.primary ? 'btn-primary' : ''}`}>
          {action.label}
        </Link>
      </div>
    </article>
  );
}

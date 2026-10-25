import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AttemptBadge, ConfirmDialog, ErrorBox, Loading, StateBadge, useToast } from '../components/ui.jsx';
import { api, useFetch } from '../lib/api.js';
import { useStudent } from '../lib/auth.jsx';
import { clockOffset, formatCountdown, formatDateTime, liveState, useNow } from '../lib/format.js';

const RESULT_TEXT = {
  immediate: 'Your score is shown as soon as you submit. Answers are revealed after the competition closes.',
  after_end: 'Scores and answers are published after the competition closes.',
  hidden: 'Results will be announced by the organisers.',
};

export default function CompetitionPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useStudent();
  const { data, error, loading, reload } = useFetch(`/competitions/${id}`);
  const now = useNow(clockOffset(data?.serverNow));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [confirmStart, setConfirmStart] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const c = data.competition;
  const state = liveState(c, now);
  const me = c.me;
  const finished = me?.attemptStatus === 'submitted' || me?.attemptStatus === 'auto_submitted';

  const register = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/student/competitions/${c.id}/register`);
      toast('You are registered for this competition');
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  let action = null;
  if (!user) {
    action =
      state !== 'ended' ? (
        <div className="action-row">
          <Link to={`/register?next=/competitions/${c.id}`} className="btn btn-primary btn-lg">
            Register to participate
          </Link>
          <Link to={`/login?next=/competitions/${c.id}`} className="btn btn-lg">
            Log in
          </Link>
        </div>
      ) : null;
  } else if (finished) {
    action = (
      <Link to={`/competitions/${c.id}/result`} className="btn btn-primary btn-lg">
        View my result
      </Link>
    );
  } else if (me?.attemptStatus === 'in_progress' && state === 'live') {
    action = (
      <Link to={`/quiz/${c.id}`} className="btn btn-primary btn-lg">
        Resume quiz
      </Link>
    );
  } else if (state === 'ended') {
    action = null;
  } else if (!me?.registered) {
    action = (
      <button type="button" className="btn btn-primary btn-lg" onClick={register} disabled={busy}>
        {busy ? 'Registering…' : 'Register for this competition'}
      </button>
    );
  } else if (state === 'upcoming') {
    action = (
      <div className="alert alert-success">
        You are registered. Come back when the quiz starts — the Start button will appear here automatically.
      </div>
    );
  } else {
    action = (
      <button type="button" className="btn btn-primary btn-lg" onClick={() => setConfirmStart(true)}>
        Start quiz
      </button>
    );
  }

  return (
    <div className="competition-page">
      <Link to={user ? '/dashboard' : '/'} className="back-link">
        ← Back
      </Link>
      <div className="card competition-hero">
        <div className="competition-card-top">
          <StateBadge state={state} />
          {me?.registered && <AttemptBadge status={me.attemptStatus} />}
        </div>
        <h1>{c.title}</h1>
        {c.description && <p className="lead">{c.description}</p>}

        {state === 'upcoming' && (
          <div className="big-countdown">
            <span>Starts in</span>
            <strong>{formatCountdown(new Date(c.startsAt).getTime() - now)}</strong>
          </div>
        )}
        {state === 'live' && (
          <div className="big-countdown live">
            <span>Closes in</span>
            <strong>{formatCountdown(new Date(c.endsAt).getTime() - now)}</strong>
          </div>
        )}

        <dl className="meta-list meta-list-wide">
          <div>
            <dt>Opens</dt>
            <dd>{formatDateTime(c.startsAt)}</dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd>{formatDateTime(c.endsAt)}</dd>
          </div>
          <div>
            <dt>Time limit</dt>
            <dd>{c.durationMinutes} minutes</dd>
          </div>
        </dl>

        <ErrorBox error={actionError} />
        {action && <div className="competition-action">{action}</div>}
        {c.scoresVisible && (
          <Link to={`/competitions/${c.id}/leaderboard`} className="btn btn-ghost">
            View leaderboard
          </Link>
        )}
      </div>

      <div className="card">
        <h2>Instructions</h2>
        <ul className="rules">
          <li>You get {c.durationMinutes} minutes from the moment you press Start, but the quiz closes for everyone at {formatDateTime(c.endsAt)}.</li>
          <li>Answers are saved automatically. If your connection drops or the page reloads, log in again and press Resume — your answers and remaining time are kept.</li>
          <li>When the timer reaches zero your quiz is submitted automatically.</li>
          <li>Leaving the quiz tab is recorded and reported to the organisers.</li>
          <li>{RESULT_TEXT[c.resultsVisibility]}</li>
        </ul>
        {c.instructions && <div className="prewrap instructions">{c.instructions}</div>}
      </div>

      {confirmStart && (
        <ConfirmDialog
          title="Start the quiz?"
          message={
            <>
              <p>
                Your <strong>{c.durationMinutes}-minute</strong> timer starts as soon as you continue and keeps running even
                if you close the page.
              </p>
              <p>Make sure you have a stable internet connection.</p>
            </>
          }
          confirmLabel="Start now"
          onCancel={() => setConfirmStart(false)}
          onConfirm={() => navigate(`/quiz/${c.id}`)}
        />
      )}
    </div>
  );
}

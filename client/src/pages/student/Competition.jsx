import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorBox, PhaseBadge, Spinner, formatClock, formatDateTime, phaseOf, useApi, useNow, useToast } from '../../components/ui.jsx';

export default function StudentCompetition() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const { data, error, loading, reload } = useApi(`/student/competitions/${id}`);
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const now = useNow();

  if (loading && !data) return <Spinner />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const c = data.competition;
  const phase = phaseOf(c, now);
  const startsIn = new Date(c.start_time).getTime() - now;

  async function registerNow() {
    setBusy(true);
    try {
      await api(`/student/competitions/${id}/register`, { method: 'POST' });
      notify('You are registered! 🎉');
      reload();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    try {
      await api(`/student/competitions/${id}/start`, { method: 'POST' });
      navigate(`/quiz/${id}`);
    } catch (err) {
      notify(err.message, 'error');
      setBusy(false);
    }
  }

  let action = null;
  if (c.attempt_status === 'submitted') {
    action = (
      <Link to={`/competitions/${id}/result`} className="btn btn-primary btn-lg">
        View your result
      </Link>
    );
  } else if (c.attempt_status === 'in_progress' && phase === 'live') {
    action = (
      <Link to={`/quiz/${id}`} className="btn btn-primary btn-lg">
        Resume quiz
      </Link>
    );
  } else if (!c.registered) {
    action =
      phase === 'ended' ? (
        <p className="muted">This competition has ended.</p>
      ) : c.registration_open ? (
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={registerNow}>
          Register for this competition
        </button>
      ) : (
        <p className="muted">Registration is closed.</p>
      );
  } else if (phase === 'upcoming') {
    action = (
      <div className="countdown-box">
        <div className="muted">You're registered. The quiz opens in</div>
        <div className="countdown">{formatClock(startsIn)}</div>
        {startsIn > 86400000 && <div className="muted small">{Math.floor(startsIn / 86400000)} day(s)</div>}
      </div>
    );
  } else if (phase === 'live') {
    action = (
      <div className="stack">
        <label className="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I have read the rules. I understand the timer starts as soon as I begin and cannot be paused.</span>
        </label>
        <button type="button" className="btn btn-primary btn-lg" disabled={!agreed || busy} onClick={start}>
          {busy ? 'Starting…' : 'Start quiz now'}
        </button>
      </div>
    );
  } else {
    action = <p className="muted">This competition has ended.</p>;
  }

  return (
    <div className="stack-lg narrow">
      <Link to="/dashboard" className="muted">
        ← All competitions
      </Link>
      <div className="card stack">
        <div className="row between wrap">
          <PhaseBadge competition={{ ...c, status: 'published' }} />
          {c.registered && <span className="badge badge-teal">Registered</span>}
        </div>
        <h1>{c.title}</h1>
        {c.description && <p className="lead">{c.description}</p>}
        <dl className="meta meta-wide">
          <div>
            <dt>Opens</dt>
            <dd>{formatDateTime(c.start_time)}</dd>
          </div>
          <div>
            <dt>Closes</dt>
            <dd>{formatDateTime(c.end_time)}</dd>
          </div>
          <div>
            <dt>Time allowed</dt>
            <dd>{c.duration_minutes} minutes</dd>
          </div>
          <div>
            <dt>Questions</dt>
            <dd>{c.question_count}</dd>
          </div>
          <div>
            <dt>Negative marking</dt>
            <dd>{c.negative_mark > 0 ? `−${c.negative_mark} per wrong answer` : 'None'}</dd>
          </div>
          <div>
            <dt>Registered</dt>
            <dd>{c.registered_count} students</dd>
          </div>
        </dl>
        {c.rules && (
          <div>
            <h3>Rules</h3>
            <div className="rules">{c.rules}</div>
          </div>
        )}
        <ul className="rules-list muted">
          <li>Your answers are saved automatically every time you choose an option.</li>
          <li>If you lose connection or refresh, log in again and resume — the timer keeps running.</li>
          <li>The quiz is submitted automatically when your time is up{c.max_tab_switches !== null && ` or after ${c.max_tab_switches} tab switch(es)`}.</li>
          <li>Joining late? You still have to finish before the competition closes at {formatDateTime(c.end_time)}.</li>
        </ul>
        <div className="action-zone">{action}</div>
      </div>
    </div>
  );
}

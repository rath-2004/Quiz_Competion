import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, ErrorBox, Loading } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { clockOffset, formatCountdown, formatScore, useNow } from '../lib/format.js';

const LETTERS = 'ABCDEF';

// Unsaved answers and review marks live in localStorage so a crash or reload loses nothing.
const storage = {
  read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or disabled; the server copy still exists */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export default function Quiz() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [marked, setMarked] = useState([]);
  const [current, setCurrent] = useState(0);
  const [saveState, setSaveState] = useState('saved');
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [offset, setOffset] = useState(0);

  const pending = useRef(new Map());
  const inFlight = useRef(null);
  const retryTimer = useRef(null);
  const retryDelay = useRef(1000);
  const closed = useRef(false);
  const keys = useRef({});

  const now = useNow(offset, 250);
  const remaining = quiz ? new Date(quiz.attempt.deadlineAt).getTime() - now : null;

  const goToResult = useCallback(() => {
    closed.current = true;
    storage.remove(keys.current.pending);
    storage.remove(keys.current.marked);
    navigate(`/competitions/${id}/result`, { replace: true });
  }, [id, navigate]);

  // ---- Loading / resuming --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    api.post(`/student/competitions/${id}/start`).then(
      (payload) => {
        if (cancelled) return;
        if (payload.attempt.status !== 'in_progress') {
          navigate(`/competitions/${id}/result`, { replace: true });
          return;
        }
        keys.current = { pending: `qc:pending:${payload.attempt.id}`, marked: `qc:marked:${payload.attempt.id}` };
        const unsaved = storage.read(keys.current.pending, {});
        pending.current = new Map(Object.entries(unsaved).map(([q, o]) => [Number(q), o]));
        setAnswers({ ...payload.answers, ...unsaved });
        setMarked(storage.read(keys.current.marked, []));
        setOffset(clockOffset(payload.serverNow));
        setQuiz(payload);
      },
      (err) => !cancelled && setLoadError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  // ---- Saving answers --------------------------------------------------------
  const persistPending = () => storage.write(keys.current.pending, Object.fromEntries(pending.current));

  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current.catch(() => {});
    if (closed.current || pending.current.size === 0) return;
    clearTimeout(retryTimer.current);
    const batch = new Map(pending.current);
    setSaveState('saving');
    const request = api.put(`/student/competitions/${id}/answers`, {
      answers: [...batch].map(([questionId, option]) => ({ questionId, option })),
    });
    inFlight.current = request;
    try {
      await request;
      for (const [q, o] of batch) if (pending.current.get(q) === o) pending.current.delete(q);
      persistPending();
      retryDelay.current = 1000;
      setSaveState(pending.current.size ? 'saving' : 'saved');
      if (pending.current.size) setTimeout(flush, 0);
    } catch (err) {
      if (err.status === 409) {
        // Already submitted or time is up on the server: nothing more can be saved.
        goToResult();
        return;
      }
      if (err.status === 400) {
        for (const q of batch.keys()) pending.current.delete(q);
        persistPending();
      }
      setSaveState('error');
      retryTimer.current = setTimeout(flush, retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, 15000);
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, [id, goToResult]);

  const flushSoon = useRef(null);
  const queueAnswer = (questionId, option) => {
    setAnswers((a) => ({ ...a, [questionId]: option }));
    pending.current.set(questionId, option);
    persistPending();
    setSaveState('saving');
    clearTimeout(flushSoon.current);
    flushSoon.current = setTimeout(flush, 300);
  };

  useEffect(() => {
    if (!quiz) return undefined;
    if (pending.current.size) flush();
    const onOnline = () => flush();
    const onBeforeUnload = (e) => {
      if (pending.current.size && !closed.current) e.preventDefault();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearTimeout(retryTimer.current);
      clearTimeout(flushSoon.current);
    };
  }, [quiz, flush]);

  // ---- Tab switch tracking ---------------------------------------------------
  useEffect(() => {
    if (!quiz) return undefined;
    // Reloading or closing the page also hides it; pagehide fires first, so those aren't counted.
    let unloading = false;
    const onPageHide = () => {
      unloading = true;
    };
    const onPageShow = () => {
      unloading = false;
    };
    const onVisibility = () => {
      if (document.hidden && !closed.current && !unloading) {
        setTabSwitches((n) => n + 1);
        api.post(`/student/competitions/${id}/tab-switch`).catch(() => {});
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [quiz, id]);

  // ---- Submitting ------------------------------------------------------------
  const submit = useCallback(async () => {
    if (closed.current) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      for (let i = 0; i < 3 && pending.current.size; i++) await flush();
      if (closed.current) return;
      await api.post(`/student/competitions/${id}/submit`);
      goToResult();
    } catch (err) {
      setSubmitError(err);
      setSubmitting(false);
    }
  }, [flush, goToResult, id]);

  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (quiz && remaining !== null && remaining <= 0 && !autoSubmitted.current) {
      autoSubmitted.current = true;
      setConfirmSubmit(false);
      submit();
    }
  }, [quiz, remaining, submit]);

  // ---- Navigation & keyboard -------------------------------------------------
  const questions = quiz?.questions ?? [];
  const question = questions[current];

  const toggleMark = () => {
    setMarked((m) => {
      const next = m.includes(question.id) ? m.filter((x) => x !== question.id) : [...m, question.id];
      storage.write(keys.current.marked, next);
      return next;
    });
  };

  useEffect(() => {
    if (!question) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || confirmSubmit) return;
      if (e.key === 'ArrowRight') setCurrent((i) => Math.min(i + 1, questions.length - 1));
      else if (e.key === 'ArrowLeft') setCurrent((i) => Math.max(i - 1, 0));
      else {
        const pos = LETTERS.indexOf(e.key.toUpperCase());
        if (pos !== -1 && pos < question.options.length) queueAnswer(question.id, question.options[pos].index);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ---- Rendering -------------------------------------------------------------
  if (loadError) {
    return (
      <div className="container narrow quiz-message">
        <ErrorBox error={loadError} />
        <Link to={`/competitions/${id}`} className="btn">
          Back to competition
        </Link>
      </div>
    );
  }
  if (!quiz) return <Loading label="Preparing your quiz…" />;

  const answeredCount = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== null).length;
  const unanswered = questions.length - answeredCount;
  const lowTime = remaining !== null && remaining < 60_000;
  const timeUp = remaining !== null && remaining <= 0;

  return (
    <div className="quiz" onContextMenu={(e) => e.preventDefault()}>
      <header className="quiz-header">
        <div className="quiz-title">
          <strong>{quiz.competition.title}</strong>
          <span className={`save-state save-${saveState}`} aria-live="polite">
            {saveState === 'saved' && '✓ All answers saved'}
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'error' && 'Connection problem — retrying. Keep answering, nothing is lost.'}
          </span>
        </div>
        <div className={`timer ${lowTime ? 'timer-low' : ''}`} role="timer" aria-label="Time remaining">
          {formatCountdown(remaining)}
        </div>
      </header>

      {tabSwitches > 0 && (
        <div className="quiz-warning" role="alert">
          You left the quiz tab {tabSwitches} time{tabSwitches > 1 ? 's' : ''}. This is reported to the organisers.
        </div>
      )}

      <div className="quiz-body">
        <main className="quiz-main card">
          {question ? (
            <>
              <div className="question-meta">
                <span>
                  Question {current + 1} of {questions.length}
                </span>
                <span>
                  {formatScore(question.marks)} mark{question.marks === 1 ? '' : 's'}
                  {question.negativeMarks > 0 && ` · −${formatScore(question.negativeMarks)} for a wrong answer`}
                </span>
              </div>
              <h2 className="question-text prewrap no-select">{question.text}</h2>
              <div className="options" role="radiogroup" aria-label="Answer options">
                {question.options.map((o, pos) => {
                  const selected = answers[question.id] === o.index;
                  return (
                    <button
                      type="button"
                      key={o.index}
                      role="radio"
                      aria-checked={selected}
                      className={`option ${selected ? 'selected' : ''}`}
                      onClick={() => queueAnswer(question.id, o.index)}
                      disabled={timeUp}
                    >
                      <span className="option-key">{LETTERS[pos]}</span>
                      <span className="option-text prewrap no-select">{o.text}</span>
                    </button>
                  );
                })}
              </div>
              <div className="quiz-actions">
                <div className="quiz-actions-left">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => queueAnswer(question.id, null)}
                    disabled={answers[question.id] === undefined || answers[question.id] === null || timeUp}
                  >
                    Clear answer
                  </button>
                  <button type="button" className={`btn btn-ghost ${marked.includes(question.id) ? 'is-marked' : ''}`} onClick={toggleMark}>
                    {marked.includes(question.id) ? '★ Marked for review' : '☆ Mark for review'}
                  </button>
                </div>
                <div className="quiz-actions-right">
                  <button type="button" className="btn" onClick={() => setCurrent((i) => i - 1)} disabled={current === 0}>
                    ← Previous
                  </button>
                  {current < questions.length - 1 ? (
                    <button type="button" className="btn btn-primary" onClick={() => setCurrent((i) => i + 1)}>
                      Next →
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => setConfirmSubmit(true)}>
                      Finish
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p>No questions available.</p>
          )}
        </main>

        <aside className="palette card">
          <div className="palette-head">
            <strong>
              {answeredCount}/{questions.length} answered
            </strong>
          </div>
          <div className="palette-grid">
            {questions.map((q, i) => {
              const answered = answers[q.id] !== undefined && answers[q.id] !== null;
              const classes = ['palette-item', answered && 'answered', marked.includes(q.id) && 'marked', i === current && 'current']
                .filter(Boolean)
                .join(' ');
              return (
                <button type="button" key={q.id} className={classes} onClick={() => setCurrent(i)} aria-label={`Question ${i + 1}`}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <ul className="palette-legend">
            <li>
              <span className="palette-item answered" /> Answered
            </li>
            <li>
              <span className="palette-item" /> Not answered
            </li>
            <li>
              <span className="palette-item marked" /> Marked
            </li>
          </ul>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setConfirmSubmit(true)} disabled={submitting}>
            Submit quiz
          </button>
          <p className="field-hint">Keyboard: A–F to answer, ← → to move.</p>
        </aside>
      </div>

      {confirmSubmit && !timeUp && (
        <ConfirmDialog
          title="Submit your quiz?"
          message={
            <>
              <p>
                You answered <strong>{answeredCount}</strong> of {questions.length} questions.
                {unanswered > 0 && (
                  <>
                    {' '}
                    <strong>{unanswered}</strong> {unanswered === 1 ? 'is' : 'are'} still unanswered.
                  </>
                )}
              </p>
              {marked.length > 0 && <p>{marked.length} question(s) are marked for review.</p>}
              <p>You cannot change your answers after submitting.</p>
              <ErrorBox error={submitError} />
            </>
          }
          confirmLabel="Submit"
          busy={submitting}
          onCancel={() => setConfirmSubmit(false)}
          onConfirm={submit}
        />
      )}

      {timeUp && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-label="Time is up">
            <div className="modal-body center">
              <h2>Time is up</h2>
              {submitError ? (
                <>
                  <ErrorBox error={submitError} />
                  <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
                    Try again
                  </button>
                  <p className="field-hint">Don&apos;t worry — your saved answers will be submitted automatically.</p>
                </>
              ) : (
                <p>Submitting your answers…</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorBox, Modal, Spinner, formatClock, useNow, useToast } from '../../components/ui.jsx';

const RETRY_MS = 3000;

export default function Quiz() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();

  const [quiz, setQuiz] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [answers, setAnswers] = useState({});
  const [current, setCurrent] = useState(0);
  const [visited, setVisited] = useState(() => new Set());
  const [saveStatus, setSaveStatus] = useState('saved');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tabWarning, setTabWarning] = useState(null);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const offset = useRef(0); // server clock − local clock
  const answersRef = useRef({});
  const pending = useRef(new Map()); // questionId → payload not yet confirmed by the server
  const flushing = useRef(null);
  const retryTimer = useRef(null);
  const finished = useRef(false);
  const now = useNow(500);

  const goToResult = useCallback(
    (reason) => {
      finished.current = true;
      navigate(`/competitions/${id}/result`, { replace: true, state: { reason } });
    },
    [id, navigate],
  );

  // ---- Loading -------------------------------------------------------------------------------------------
  useEffect(() => {
    api(`/student/competitions/${id}/attempt`)
      .then((data) => {
        if (data.status === 'submitted') return goToResult('submitted');
        offset.current = new Date(data.serverNow).getTime() - Date.now();
        const initial = {};
        for (const q of data.questions) initial[q.id] = { selected: q.selected, markedReview: q.markedReview };
        answersRef.current = initial;
        setAnswers(initial);
        setTabSwitches(data.tabSwitches);
        // Resume at the first unanswered question.
        const firstOpen = data.questions.findIndex((q) => q.selected === null);
        const start = firstOpen === -1 ? 0 : firstOpen;
        setCurrent(start);
        setVisited(new Set(data.questions.filter((q) => q.selected !== null).map((q) => q.id).concat(data.questions[start]?.id)));
        setQuiz(data);
      })
      .catch((err) => {
        if (err.status === 404) navigate(`/competitions/${id}`, { replace: true });
        else setLoadError(err);
      });
  }, [id, navigate, goToResult]);

  // ---- Saving --------------------------------------------------------------------------------------------
  const flush = useCallback(() => {
    if (flushing.current) return flushing.current;
    clearTimeout(retryTimer.current);
    flushing.current = (async () => {
      while (pending.current.size > 0) {
        const [questionId, payload] = pending.current.entries().next().value;
        setSaveStatus('saving');
        try {
          await api(`/student/competitions/${id}/answer`, { method: 'PUT', body: payload });
          // Only clear if the student didn't change the answer again while this request was in flight.
          if (pending.current.get(questionId) === payload) pending.current.delete(questionId);
        } catch (err) {
          if (err.status === 409) {
            pending.current.clear();
            goToResult('time');
            return;
          }
          if (err.status === 400) {
            pending.current.delete(questionId);
            notify(err.message, 'error');
            continue;
          }
          setSaveStatus('offline');
          retryTimer.current = setTimeout(flush, RETRY_MS);
          return;
        }
      }
      setSaveStatus('saved');
    })().finally(() => {
      flushing.current = null;
    });
    return flushing.current;
  }, [id, goToResult, notify]);

  const updateAnswer = useCallback(
    (questionId, patch) => {
      if (finished.current) return;
      const next = { ...answersRef.current[questionId], ...patch };
      answersRef.current = { ...answersRef.current, [questionId]: next };
      setAnswers(answersRef.current);
      pending.current.set(questionId, { questionId, selected: next.selected ?? null, markedReview: Boolean(next.markedReview) });
      flush();
    },
    [flush],
  );

  // ---- Submitting ----------------------------------------------------------------------------------------
  const submit = useCallback(
    async (reason) => {
      if (finished.current) return;
      finished.current = true;
      setSubmitting(true);
      // Push any unsaved answers first; the server accepts them for a short grace period after the deadline.
      for (let i = 0; i < 3 && pending.current.size > 0; i++) {
        await flush();
        if (pending.current.size > 0) await new Promise((r) => setTimeout(r, 1000));
      }
      try {
        await api(`/student/competitions/${id}/submit`, { method: 'POST' });
      } catch {
        // If this fails the server's auto-submit will finalise the attempt.
      }
      goToResult(reason);
    },
    [flush, id, goToResult],
  );

  const deadline = quiz ? new Date(quiz.deadline).getTime() : null;
  const remaining = deadline ? deadline - (now + offset.current) : null;

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && !finished.current) submit('time');
  }, [remaining, submit]);

  // ---- Integrity: tab switches, leaving the page, copying ---------------------------------------------------
  useEffect(() => {
    if (!quiz) return undefined;
    // Counted when the student comes back, so a page reload (which also hides the page) isn't a "switch".
    let wasHidden = false;
    const onVisibility = async () => {
      if (finished.current) return;
      if (document.visibilityState === 'hidden') {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      try {
        const r = await api(`/student/competitions/${id}/tab-switch`, { method: 'POST' });
        if (r.autoSubmitted) goToResult('tab');
        else {
          setTabSwitches(r.tabSwitches);
          setTabWarning(r.tabSwitches);
        }
      } catch (err) {
        if (err.status === 409) goToResult('time');
      }
    };
    const onBeforeUnload = (e) => {
      if (finished.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onOnline = () => flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('online', onOnline);
      clearTimeout(retryTimer.current);
    };
  }, [quiz, id, goToResult, flush]);

  const questions = quiz?.questions ?? [];
  const q = questions[current];

  const goTo = useCallback(
    (index) => {
      if (index < 0 || index >= questions.length) return;
      setCurrent(index);
      setVisited((v) => new Set(v).add(questions[index].id));
    },
    [questions],
  );

  // Keyboard: ← → to move, A–F or 1–6 to choose.
  useEffect(() => {
    if (!q) return undefined;
    const onKey = (e) => {
      if (confirmOpen || tabWarning !== null || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') goTo(current + 1);
      else if (e.key === 'ArrowLeft') goTo(current - 1);
      else {
        const k = e.key.toUpperCase();
        let pos = 'ABCDEF'.indexOf(k);
        if (pos === -1 && /^[1-6]$/.test(k)) pos = Number(k) - 1;
        if (pos >= 0 && pos < q.options.length) updateAnswer(q.id, { selected: q.options[pos].index });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [q, current, goTo, updateAnswer, confirmOpen, tabWarning]);

  if (loadError) {
    return (
      <div className="container narrow pad-top">
        <ErrorBox error={loadError} onRetry={() => window.location.reload()} />
      </div>
    );
  }
  if (!quiz) return <Spinner label="Loading your quiz…" />;

  const answeredCount = questions.filter((x) => answers[x.id]?.selected !== null && answers[x.id]?.selected !== undefined).length;
  const markedCount = questions.filter((x) => answers[x.id]?.markedReview).length;
  const a = answers[q.id] ?? {};
  const lowTime = remaining !== null && remaining < 60_000;

  function paletteClass(question, index) {
    const ans = answers[question.id];
    const answered = ans?.selected !== null && ans?.selected !== undefined;
    let cls = 'pal-btn';
    if (ans?.markedReview) cls += answered ? ' pal-marked-answered' : ' pal-marked';
    else if (answered) cls += ' pal-answered';
    else if (visited.has(question.id)) cls += ' pal-skipped';
    if (index === current) cls += ' pal-current';
    return cls;
  }

  return (
    <div className="quiz-shell" onCopy={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
      <header className="quiz-top">
        <div className="quiz-title truncate">{quiz.title}</div>
        <div className={`save-status save-${saveStatus}`}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'offline' ? 'Offline — retrying' : 'All answers saved'}
        </div>
        <div className={`timer ${lowTime ? 'timer-low' : ''}`} aria-live="off">
          ⏱ {formatClock(remaining)}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)} disabled={submitting}>
          Submit
        </button>
      </header>

      <div className="quiz-body">
        <main className="quiz-main card">
          <div className="q-head">
            <span className="q-number">
              Question {current + 1} <span className="muted">of {questions.length}</span>
            </span>
            <span className="muted small">
              +{q.marks} mark{q.marks === 1 ? '' : 's'}
              {quiz.negativeMark > 0 && ` · −${quiz.negativeMark} if wrong`}
            </span>
          </div>
          <div className="q-text">{q.text}</div>
          {q.imageUrl && <img className="q-image" src={q.imageUrl} alt="" />}
          <div className="options" role="radiogroup" aria-label="Answer options">
            {q.options.map((opt, i) => {
              const selected = a.selected === opt.index;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  key={opt.index}
                  className={`option ${selected ? 'option-selected' : ''}`}
                  onClick={() => updateAnswer(q.id, { selected: opt.index })}
                >
                  <span className="opt-key">{String.fromCharCode(65 + i)}</span>
                  <span className="opt-text">{opt.text}</span>
                </button>
              );
            })}
          </div>
          <div className="q-actions">
            <button type="button" className="btn" disabled={current === 0} onClick={() => goTo(current - 1)}>
              ‹ Previous
            </button>
            <button
              type="button"
              className={`btn ${a.markedReview ? 'btn-purple' : ''}`}
              onClick={() => updateAnswer(q.id, { markedReview: !a.markedReview })}
            >
              {a.markedReview ? '★ Marked for review' : '☆ Mark for review'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={a.selected === null || a.selected === undefined}
              onClick={() => updateAnswer(q.id, { selected: null })}
            >
              Clear
            </button>
            {current < questions.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => goTo(current + 1)}>
                Next ›
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => setConfirmOpen(true)}>
                Finish
              </button>
            )}
          </div>
        </main>

        <aside className="palette card">
          <div className="palette-counts">
            <div>
              <strong>{answeredCount}</strong>
              <span className="muted small">answered</span>
            </div>
            <div>
              <strong>{questions.length - answeredCount}</strong>
              <span className="muted small">left</span>
            </div>
            <div>
              <strong>{markedCount}</strong>
              <span className="muted small">marked</span>
            </div>
          </div>
          <div className="palette-grid">
            {questions.map((question, index) => (
              <button
                type="button"
                key={question.id}
                className={paletteClass(question, index)}
                onClick={() => goTo(index)}
                aria-label={`Question ${index + 1}`}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <div className="legend small">
            <span><i className="pal-dot pal-answered" /> Answered</span>
            <span><i className="pal-dot pal-skipped" /> Not answered</span>
            <span><i className="pal-dot pal-marked" /> Marked</span>
            <span><i className="pal-dot" /> Not visited</span>
          </div>
          {quiz.maxTabSwitches !== null && (
            <p className="muted small">
              Tab switches: {tabSwitches} / {quiz.maxTabSwitches} allowed
            </p>
          )}
        </aside>
      </div>

      {confirmOpen && (
        <Modal
          title="Submit your quiz?"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmOpen(false)}>
                Keep working
              </button>
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => submit('manual')}>
                {submitting ? 'Submitting…' : 'Yes, submit'}
              </button>
            </>
          }
        >
          <div className="summary-grid">
            <div>
              <strong>{answeredCount}</strong>
              <span>Answered</span>
            </div>
            <div>
              <strong>{questions.length - answeredCount}</strong>
              <span>Not answered</span>
            </div>
            <div>
              <strong>{markedCount}</strong>
              <span>Marked for review</span>
            </div>
          </div>
          <p className="muted">You cannot change your answers after submitting. Time left: {formatClock(remaining)}.</p>
        </Modal>
      )}

      {tabWarning !== null && (
        <Modal
          title="⚠ You left the quiz window"
          onClose={() => setTabWarning(null)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setTabWarning(null)}>
              Return to quiz
            </button>
          }
        >
          <p>
            Switching tabs or apps is recorded. This was switch <strong>#{tabWarning}</strong>
            {quiz.maxTabSwitches !== null && (
              <>
                {' '}
                — your quiz is submitted automatically after <strong>{quiz.maxTabSwitches}</strong>
              </>
            )}
            .
          </p>
        </Modal>
      )}

      {submitting && (
        <div className="modal-backdrop">
          <Spinner label="Submitting your answers…" />
        </div>
      )}
    </div>
  );
}

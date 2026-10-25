import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import {
  Badge,
  Empty,
  ErrorBox,
  Field,
  Modal,
  Pagination,
  PhaseBadge,
  Spinner,
  StatCard,
  formatDateTime,
  formatDuration,
  formatScore,
  phaseOf,
  useApi,
  useDebounced,
  useToast,
} from '../../components/ui.jsx';
import { DifficultyBadge, QuestionFormModal, QuestionImportModal } from './Questions.jsx';

const TABS = [
  ['overview', 'Overview'],
  ['questions', 'Questions'],
  ['participants', 'Participants'],
  ['leaderboard', 'Leaderboard'],
];

export default function AdminCompetitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';
  const detail = useApi(`/admin/competitions/${id}`, { interval: 15000 });
  const c = detail.data?.competition;

  if (detail.loading && !c) return <Spinner />;
  if (!c) return <ErrorBox error={detail.error} onRetry={detail.reload} />;

  async function action(path, body, message, method = 'POST') {
    try {
      const r = await api(`/admin/competitions/${id}${path}`, { method, body });
      notify(typeof message === 'function' ? message(r) : message);
      detail.reload();
      return r;
    } catch (err) {
      notify(err.message, 'error');
      return null;
    }
  }

  async function remove() {
    const typed = window.prompt(`This permanently deletes "${c.title}" with all registrations and results.\nType DELETE to confirm.`);
    if (typed !== 'DELETE') return;
    if (await action('', undefined, 'Competition deleted', 'DELETE')) navigate('/admin/competitions');
  }

  const phase = phaseOf(c);

  return (
    <div className="stack-lg">
      <Link to="/admin/competitions" className="muted">
        ← Competitions
      </Link>
      <div className="page-head">
        <div className="stack-sm">
          <div className="row gap-sm wrap">
            <PhaseBadge competition={c} />
            {c.results_published && <Badge tone="teal">Results published</Badge>}
            {!c.registration_open && <Badge tone="gray">Registration closed</Badge>}
          </div>
          <h1>{c.title}</h1>
          <p className="muted">
            {formatDateTime(c.start_time)} → {formatDateTime(c.end_time)} · {c.duration_minutes} min per student
          </p>
        </div>
        <div className="row gap-sm wrap">
          <Link to={`/admin/competitions/${id}/edit`} className="btn">
            Edit settings
          </Link>
          {c.status === 'draft' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                action('', { ...pickSettings(c), status: 'published' }, 'Competition published — students can now see it', 'PUT')
              }
            >
              Publish
            </button>
          ) : (
            <button
              type="button"
              className={`btn ${c.results_published ? '' : 'btn-primary'}`}
              onClick={() =>
                action('/publish-results', { published: !c.results_published }, c.results_published ? 'Results hidden' : 'Results published to students')
              }
            >
              {c.results_published ? 'Unpublish results' : 'Publish results'}
            </button>
          )}
          <a className="btn" href={`/api/admin/competitions/${id}/export`}>
            ⬇ Results CSV
          </a>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab ${tab === key ? 'active' : ''}`}
            onClick={() => setParams({ tab: key }, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="stack-lg">
          {c.assigned_questions === 0 && (
            <div className="alert alert-warn">
              This competition has no questions yet.{' '}
              <button type="button" className="link-btn" onClick={() => setParams({ tab: 'questions' })}>
                Add questions →
              </button>
            </div>
          )}
          <div className="stats-row">
            <StatCard label="Registered" value={c.registered_count} tone="indigo" />
            <StatCard label="Taking it now" value={c.in_progress_count} tone="green" />
            <StatCard label="Submitted" value={c.submitted_count} />
            <StatCard label="Average score" value={formatScore(c.avg_score)} />
            <StatCard label="Top score" value={formatScore(c.top_score)} />
            <StatCard
              label="Questions"
              value={c.question_count ? Math.min(c.question_count, c.assigned_questions) : c.assigned_questions}
              hint={c.question_count && c.question_count < c.assigned_questions ? `random from pool of ${c.assigned_questions}` : 'per student'}
            />
          </div>
          <div className="grid-2 gap-lg">
            <section className="card stack">
              <h2>Settings</h2>
              <dl className="kv">
                <dt>Status</dt>
                <dd>{c.status}</dd>
                <dt>Negative marking</dt>
                <dd>{c.negative_mark > 0 ? `−${c.negative_mark} per wrong answer` : 'None'}</dd>
                <dt>Shuffle</dt>
                <dd>
                  {c.shuffle_questions ? 'questions' : ''}
                  {c.shuffle_questions && c.shuffle_options ? ' + ' : ''}
                  {c.shuffle_options ? 'options' : ''}
                  {!c.shuffle_questions && !c.shuffle_options && 'off'}
                </dd>
                <dt>Tab-switch limit</dt>
                <dd>{c.max_tab_switches ?? 'Unlimited (recorded)'}</dd>
                <dt>Score after submit</dt>
                <dd>{c.show_result_immediately ? 'Shown immediately' : 'Hidden until results are published'}</dd>
                <dt>Registration</dt>
                <dd>{c.registration_open ? 'Open' : 'Closed'}</dd>
              </dl>
              {c.description && <p className="muted">{c.description}</p>}
            </section>
            <section className="card stack">
              <h2>Controls</h2>
              <RegisterStudents competitionId={id} onDone={detail.reload} />
              <div className="control-row">
                <div>
                  <strong>Submit all running attempts now</strong>
                  <div className="muted small">Use to end the competition early. {c.in_progress_count} student(s) currently in progress.</div>
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!c.in_progress_count}
                  onClick={() =>
                    window.confirm('Submit every in-progress attempt right now?') &&
                    action('/force-submit', undefined, (r) => `${r.submitted} attempt(s) submitted`)
                  }
                >
                  Force submit
                </button>
              </div>
              <div className="control-row">
                <div>
                  <strong>Re-calculate scores</strong>
                  <div className="muted small">After fixing a wrong answer key in the question bank.</div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => action('/rescore', undefined, (r) => `${r.rescored} attempt(s) re-scored`)}>
                  Re-score
                </button>
              </div>
              <div className="control-row">
                <div>
                  <strong>Delete competition</strong>
                  <div className="muted small">Removes all registrations and results.</div>
                </div>
                <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
                  Delete
                </button>
              </div>
            </section>
          </div>
          {c.rules && (
            <section className="card stack">
              <h2>Rules</h2>
              <div className="rules">{c.rules}</div>
            </section>
          )}
        </div>
      )}

      {tab === 'questions' && <QuestionsTab competition={c} onChange={detail.reload} />}
      {tab === 'participants' && <ParticipantsTab competitionId={id} live={phase === 'live'} onChange={detail.reload} />}
      {tab === 'leaderboard' && <LeaderboardTab competitionId={id} />}
    </div>
  );
}

function pickSettings(c) {
  const keys = ['title', 'description', 'rules', 'start_time', 'end_time', 'duration_minutes', 'question_count', 'shuffle_questions',
    'shuffle_options', 'negative_mark', 'max_tab_switches', 'status', 'registration_open', 'show_result_immediately'];
  return Object.fromEntries(keys.map((k) => [k, c[k]]));
}

function RegisterStudents({ competitionId, onDone }) {
  const notify = useToast();
  const colleges = useApi('/admin/students/colleges');
  const [college, setCollege] = useState('');
  async function run() {
    const label = college ? `all active students of ${college}` : 'ALL active students';
    if (!window.confirm(`Register ${label} for this competition?`)) return;
    try {
      const r = await api(`/admin/competitions/${competitionId}/registrations`, { method: 'POST', body: { allStudents: true, college } });
      notify(`${r.registered} new registration(s)`);
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  return (
    <div className="control-row">
      <div className="grow">
        <strong>Bulk-register students</strong>
        <div className="muted small">Students can also register themselves while registration is open.</div>
        <select className="mt-sm" value={college} onChange={(e) => setCollege(e.target.value)}>
          <option value="">All colleges</option>
          {colleges.data?.colleges.map((c) => (
            <option key={c.college} value={c.college}>
              {c.college} ({c.count})
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn btn-sm" onClick={run}>
        Register
      </button>
    </div>
  );
}

// ---- Questions tab ---------------------------------------------------------------------------------------

function QuestionsTab({ competition: c, onChange }) {
  const notify = useToast();
  const list = useApi(`/admin/competitions/${c.id}/questions`);
  const cats = useApi('/admin/questions/categories');
  const [picker, setPicker] = useState(false);
  const [random, setRandom] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null);
  const locked = c.has_attempts;
  const reload = () => {
    list.reload();
    onChange();
  };

  async function removeOne(q) {
    try {
      await api(`/admin/competitions/${c.id}/questions/${q.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  async function clearAll() {
    if (!window.confirm('Remove all questions from this competition? (They stay in the question bank.)')) return;
    try {
      await api(`/admin/competitions/${c.id}/questions`, { method: 'DELETE' });
      reload();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const questions = list.data?.questions ?? [];
  const totalMarks = questions.reduce((s, q) => s + q.marks, 0);

  return (
    <div className="card stack">
      <div className="row between wrap gap-sm">
        <div>
          <h2>
            {questions.length} question{questions.length === 1 ? '' : 's'} assigned
          </h2>
          <p className="muted small">
            {c.question_count && c.question_count < questions.length
              ? `Each student gets ${c.question_count} random questions from this pool.`
              : `Total ${formatScore(totalMarks)} marks.`}
          </p>
        </div>
        {!locked && (
          <div className="row gap-sm wrap">
            <button type="button" className="btn" onClick={() => setPicker(true)}>
              + From question bank
            </button>
            <button type="button" className="btn" onClick={() => setRandom(true)}>
              🎲 Add random
            </button>
            <button type="button" className="btn" onClick={() => setImporting(true)}>
              ⬆ Import CSV
            </button>
            {questions.length > 0 && (
              <button type="button" className="btn btn-danger-ghost" onClick={clearAll}>
                Remove all
              </button>
            )}
          </div>
        )}
      </div>
      {locked && (
        <div className="alert alert-info">
          Students have already started, so the question set is locked. You can still fix typos or answer keys via Edit, then re-score.
        </div>
      )}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : questions.length === 0 ? (
        <Empty title="No questions yet">Pick from the question bank, add random questions by category, or import a CSV.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Question</th>
                <th>Answer</th>
                <th>Category</th>
                <th>Difficulty</th>
                <th className="num">Marks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {questions.map((q, i) => (
                <tr key={q.id}>
                  <td className="muted">{i + 1}</td>
                  <td className="q-cell">{q.text}</td>
                  <td className="small">
                    <span className="opt-key sm">{String.fromCharCode(65 + q.correct_option)}</span> {q.options[q.correct_option]}
                  </td>
                  <td>{q.category}</td>
                  <td>
                    <DifficultyBadge value={q.difficulty} />
                  </td>
                  <td className="num">{q.marks}</td>
                  <td className="actions">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(q)}>
                      Edit
                    </button>
                    {!locked && (
                      <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => removeOne(q)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picker && <BankPicker competitionId={c.id} categories={cats.data?.categories ?? []} onClose={() => setPicker(false)} onAdded={reload} />}
      {random && <RandomAdd competitionId={c.id} categories={cats.data?.categories ?? []} onClose={() => setRandom(false)} onAdded={reload} />}
      {importing && <QuestionImportModal competitionId={Number(c.id)} onClose={() => setImporting(false)} onDone={reload} />}
      {editing && (
        <QuestionFormModal
          question={editing}
          categories={cats.data?.categories ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BankPicker({ competitionId, categories, onClose, onAdded }) {
  const notify = useToast();
  const [filters, setFilters] = useState({ q: '', category: '', difficulty: '', page: 1 });
  const q = useDebounced(filters.q);
  const list = useApi(
    `/admin/questions${qs({ q, category: filters.category, difficulty: filters.difficulty, page: filters.page, pageSize: 20, excludeCompetition: competitionId })}`,
  );
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const items = list.data?.items ?? [];
  const toggle = (qid) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(qid)) n.delete(qid);
      else n.add(qid);
      return n;
    });
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));

  async function add() {
    setBusy(true);
    try {
      const r = await api(`/admin/competitions/${competitionId}/questions`, { method: 'POST', body: { questionIds: [...selected] } });
      notify(`${r.added} question(s) added`);
      onAdded();
      onClose();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  return (
    <Modal
      title="Add questions from the bank"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted grow">{selected.size} selected</span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!selected.size || busy} onClick={add}>
            Add {selected.size || ''} question{selected.size === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="filters">
          <input type="search" placeholder="Search…" value={filters.q} onChange={set('q')} />
          <select value={filters.category} onChange={set('category')}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category}
              </option>
            ))}
          </select>
          <select value={filters.difficulty} onChange={set('difficulty')}>
            <option value="">All difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        {list.loading && !list.data ? (
          <Spinner />
        ) : items.length === 0 ? (
          <Empty title="No more questions match">All matching questions are already in this competition.</Empty>
        ) : (
          <div className="table-wrap scroll-y">
            <table className="table compact">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allOnPage}
                      aria-label="Select all on this page"
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          for (const i of items) {
                            if (allOnPage) n.delete(i.id);
                            else n.add(i.id);
                          }
                          return n;
                        })
                      }
                    />
                  </th>
                  <th>Question</th>
                  <th>Category</th>
                  <th>Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} onClick={() => toggle(item.id)} className="clickable">
                    <td>
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className="q-cell">{item.text}</td>
                    <td>{item.category}</td>
                    <td>
                      <DifficultyBadge value={item.difficulty} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(page) => setFilters({ ...filters, page })} />}
      </div>
    </Modal>
  );
}

function RandomAdd({ competitionId, categories, onClose, onAdded }) {
  const notify = useToast();
  const [form, setForm] = useState({ count: 10, category: '', difficulty: '' });
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try {
      const r = await api(`/admin/competitions/${competitionId}/questions/random`, {
        method: 'POST',
        body: { count: Number(form.count), category: form.category, difficulty: form.difficulty },
      });
      notify(`${r.added} random question(s) added`);
      onAdded();
      onClose();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Add random questions"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>
            Add
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="muted">Picks questions not yet in this competition. Run it several times to build a mix, e.g. 10 easy + 10 medium + 5 hard.</p>
        <Field label="How many">
          <input type="number" min="1" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="">Any</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Difficulty">
          <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
            <option value="">Any</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ---- Participants tab ------------------------------------------------------------------------------------

const STATUS_BADGE = {
  submitted: ['green', 'Submitted'],
  in_progress: ['amber', 'In progress'],
};

function ParticipantsTab({ competitionId, live, onChange }) {
  const notify = useToast();
  const [filters, setFilters] = useState({ q: '', status: '', page: 1 });
  const q = useDebounced(filters.q);
  const list = useApi(`/admin/competitions/${competitionId}/participants${qs({ q, status: filters.status, page: filters.page, pageSize: 50 })}`, {
    interval: live ? 10000 : undefined,
  });

  async function reset(p) {
    if (!window.confirm(`Delete ${p.name}'s attempt so they can start again? Their answers will be lost.`)) return;
    try {
      await api(`/admin/competitions/${competitionId}/attempts/${p.user_id}`, { method: 'DELETE' });
      notify('Attempt reset');
      list.reload();
      onChange();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
  async function unregister(p) {
    if (!window.confirm(`Remove ${p.name}'s registration?`)) return;
    try {
      await api(`/admin/competitions/${competitionId}/registrations/${p.user_id}`, { method: 'DELETE' });
      list.reload();
      onChange();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  return (
    <div className="card stack">
      <div className="filters">
        <input type="search" placeholder="Search name, email, roll no, college…" value={filters.q} onChange={set('q')} />
        <select value={filters.status} onChange={set('status')}>
          <option value="">All participants</option>
          <option value="registered">Registered, not started</option>
          <option value="in_progress">In progress</option>
          <option value="submitted">Submitted</option>
        </select>
        {live && <span className="muted small">Live — refreshing every 10s</span>}
      </div>
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.loading && !list.data ? (
        <Spinner />
      ) : list.data?.items.length === 0 ? (
        <Empty title="No participants match" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th>College</th>
                <th>Status</th>
                <th className="num">Answered</th>
                <th className="num">Score</th>
                <th className="num">C / W / U</th>
                <th className="num">Tab sw.</th>
                <th>Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map((p) => {
                const [tone, label] = STATUS_BADGE[p.status] ?? ['gray', 'Not started'];
                return (
                  <tr key={p.user_id}>
                    <td>
                      <Link to={`/admin/students/${p.user_id}`}>{p.name}</Link>
                      <div className="muted small">{p.roll_number} · {p.email}</div>
                    </td>
                    <td className="small">{p.college}</td>
                    <td>
                      <Badge tone={tone}>{label}</Badge>
                      {p.auto_submitted && <div className="muted small">auto</div>}
                    </td>
                    <td className="num">{p.attempt_id ? p.answered : '—'}</td>
                    <td className="num strong">{p.status === 'submitted' ? `${formatScore(p.score)} / ${formatScore(p.max_score)}` : '—'}</td>
                    <td className="num small">{p.status === 'submitted' ? `${p.correct_count} / ${p.wrong_count} / ${p.unanswered_count}` : '—'}</td>
                    <td className={`num ${p.tab_switches > 0 ? 'text-warn' : ''}`}>{p.attempt_id ? p.tab_switches : '—'}</td>
                    <td className="small">
                      {p.submitted_at
                        ? formatDuration((new Date(p.submitted_at) - new Date(p.started_at)) / 1000)
                        : p.started_at
                          ? `started ${formatDateTime(p.started_at)}`
                          : '—'}
                    </td>
                    <td className="actions">
                      {p.attempt_id ? (
                        <button type="button" className="btn btn-sm" onClick={() => reset(p)}>
                          Reset
                        </button>
                      ) : (
                        <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => unregister(p)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(page) => setFilters({ ...filters, page })} />}
    </div>
  );
}

// ---- Leaderboard tab -------------------------------------------------------------------------------------

function LeaderboardTab({ competitionId }) {
  const [college, setCollege] = useState('');
  const [limit, setLimit] = useState(100);
  const board = useApi(`/admin/competitions/${competitionId}/leaderboard${qs({ college, limit })}`);
  const rows = board.data?.leaderboard ?? [];
  const colleges = board.data?.colleges ?? [];

  return (
    <div className="stack-lg">
      <div className="card stack">
        <div className="row between wrap gap-sm">
          <h2>Leaderboard</h2>
          <div className="filters">
            <select value={college} onChange={(e) => setCollege(e.target.value)}>
              <option value="">All colleges</option>
              {colleges.map((c) => (
                <option key={c.college} value={c.college}>
                  {c.college}
                </option>
              ))}
            </select>
            <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={10}>Top 10</option>
              <option value={100}>Top 100</option>
              <option value={1000}>Top 1000</option>
            </select>
          </div>
        </div>
        <p className="muted small">Ranked by score, then by less time taken. Ranks are overall, even when filtered by college. Download the full list with “Results CSV”.</p>
        <ErrorBox error={board.error} onRetry={board.reload} />
        {board.loading && !board.data ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty title="No submissions yet" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Student</th>
                  <th>College</th>
                  <th className="num">Score</th>
                  <th className="num">Correct</th>
                  <th className="num">Wrong</th>
                  <th className="num">Time</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.rank <= 3 ? `podium podium-${r.rank}` : ''}>
                    <td className="num strong">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
                    <td>
                      <Link to={`/admin/students/${r.user_id}`}>{r.name}</Link>
                      <div className="muted small">{r.roll_number}</div>
                    </td>
                    <td className="small">{r.college}</td>
                    <td className="num strong">
                      {formatScore(r.score)} <span className="muted small">/ {formatScore(r.max_score)}</span>
                    </td>
                    <td className="num">{r.correct_count}</td>
                    <td className="num">{r.wrong_count}</td>
                    <td className="num">{formatDuration(r.time_taken_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {colleges.length > 0 && (
        <div className="card stack">
          <h2>College-wise performance</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>College</th>
                  <th className="num">Participants</th>
                  <th className="num">Average score</th>
                  <th className="num">Top score</th>
                </tr>
              </thead>
              <tbody>
                {colleges.map((c) => (
                  <tr key={c.college}>
                    <td>{c.college}</td>
                    <td className="num">{c.participants}</td>
                    <td className="num">{formatScore(c.avg_score)}</td>
                    <td className="num">{formatScore(c.top_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

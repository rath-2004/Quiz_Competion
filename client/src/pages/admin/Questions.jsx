import { useState } from 'react';
import { api, qs } from '../../api.js';
import { CsvImportModal } from '../../components/CsvImport.jsx';
import { Badge, Empty, ErrorBox, Field, Modal, Pagination, Spinner, useApi, useDebounced, useToast } from '../../components/ui.jsx';

export const QUESTION_TEMPLATE = [
  'question,option_a,option_b,option_c,option_d,option_e,option_f,correct,category,difficulty,marks,explanation,image_url',
  '"What is the capital of India?",Mumbai,New Delhi,Kolkata,Chennai,,,B,General Knowledge,easy,1,"New Delhi is the capital.",',
  '"2 + 2 × 2 = ?",8,6,4,10,,,B,Aptitude,medium,2,"Multiplication first: 2 + 4 = 6",',
].join('\n');

const DIFF_TONE = { easy: 'green', medium: 'amber', hard: 'red' };

export function DifficultyBadge({ value }) {
  return <Badge tone={DIFF_TONE[value]}>{value}</Badge>;
}

const BLANK = { text: '', options: ['', '', '', ''], correct_option: 0, category: 'General', difficulty: 'medium', marks: 1, explanation: '', image_url: '' };

export function QuestionFormModal({ question, categories = [], onClose, onSaved }) {
  const notify = useToast();
  const [form, setForm] = useState(() =>
    question ? { ...question, explanation: question.explanation ?? '', image_url: question.image_url ?? '' } : BLANK,
  );
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errors = error?.details ?? {};

  const setOption = (i, value) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? value : o)) }));
  const removeOption = (i) =>
    setForm((f) => ({
      ...f,
      options: f.options.filter((_, j) => j !== i),
      correct_option: f.correct_option === i ? 0 : f.correct_option > i ? f.correct_option - 1 : f.correct_option,
    }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      text: form.text,
      options: form.options,
      correct_option: Number(form.correct_option),
      category: form.category || 'General',
      difficulty: form.difficulty,
      marks: Number(form.marks),
      explanation: form.explanation || null,
      image_url: form.image_url || null,
    };
    try {
      const d = question
        ? await api(`/admin/questions/${question.id}`, { method: 'PUT', body })
        : await api('/admin/questions', { method: 'POST', body });
      notify(question ? 'Question updated' : 'Question added');
      onSaved(d.question);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={question ? `Edit question #${question.id}` : 'Add question'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="question-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save question'}
          </button>
        </>
      }
    >
      <form id="question-form" className="stack" onSubmit={save}>
        <ErrorBox error={error} />
        <Field label="Question" error={errors.text}>
          <textarea rows={3} required value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        </Field>
        <div className="stack-sm">
          <span className="field-label">Options — select the correct answer</span>
          {form.options.map((o, i) => (
            <div key={i} className="option-edit">
              <input
                type="radio"
                name="correct"
                checked={Number(form.correct_option) === i}
                onChange={() => setForm({ ...form, correct_option: i })}
                aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
              />
              <span className="opt-key">{String.fromCharCode(65 + i)}</span>
              <input required value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + i)}`} />
              <button type="button" className="icon-btn" disabled={form.options.length <= 2} onClick={() => removeOption(i)} aria-label="Remove option">
                ×
              </button>
            </div>
          ))}
          {form.options.length < 6 && (
            <div>
              <button type="button" className="btn btn-sm" onClick={() => setForm({ ...form, options: [...form.options, ''] })}>
                + Add option
              </button>
            </div>
          )}
          {(errors.options || errors.correct_option) && <span className="field-error">{errors.options || errors.correct_option}</span>}
        </div>
        <div className="grid-3">
          <Field label="Category" error={errors.category}>
            <input list="category-list" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <datalist id="category-list">
              {categories.map((c) => (
                <option key={c.category} value={c.category} />
              ))}
            </datalist>
          </Field>
          <Field label="Difficulty">
            <select value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </Field>
          <Field label="Marks" error={errors.marks}>
            <input type="number" min="0.25" step="0.25" value={form.marks} onChange={(e) => setForm({ ...form, marks: e.target.value })} />
          </Field>
        </div>
        <Field label="Explanation (shown after results are published)" error={errors.explanation}>
          <textarea rows={2} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
        </Field>
        <Field label="Image URL (optional)" error={errors.image_url}>
          <input type="url" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} placeholder="https://…" />
        </Field>
      </form>
    </Modal>
  );
}

export default function AdminQuestions() {
  const notify = useToast();
  const [filters, setFilters] = useState({ q: '', category: '', difficulty: '', page: 1 });
  const q = useDebounced(filters.q);
  const list = useApi(`/admin/questions${qs({ q, category: filters.category, difficulty: filters.difficulty, page: filters.page, pageSize: 25 })}`);
  const cats = useApi('/admin/questions/categories');
  const [editing, setEditing] = useState(null); // null | 'new' | question
  const [importing, setImporting] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const reloadAll = () => {
    list.reload();
    cats.reload();
  };

  async function remove(question) {
    if (!window.confirm(`Delete question #${question.id}? This cannot be undone.`)) return;
    try {
      await api(`/admin/questions/${question.id}`, { method: 'DELETE' });
      notify('Question deleted');
      reloadAll();
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value, page: 1 });
  const categories = cats.data?.categories ?? [];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>Question bank</h1>
          <p className="muted">Questions here can be used in any competition. Correct answers are never sent to students during a quiz.</p>
        </div>
        <div className="row gap-sm wrap">
          <a className="btn" href="/api/admin/questions/export">
            ⬇ Export CSV
          </a>
          <button type="button" className="btn" onClick={() => setImporting(true)}>
            ⬆ Import CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add question
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="filters">
          <input type="search" placeholder="Search question or option text…" value={filters.q} onChange={set('q')} />
          <select value={filters.category} onChange={set('category')}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category} ({c.count})
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
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.loading && !list.data ? (
          <Spinner />
        ) : list.data?.items.length === 0 ? (
          <Empty title="No questions found">Add questions one by one or import a CSV file.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Question</th>
                  <th>Category</th>
                  <th>Difficulty</th>
                  <th className="num">Marks</th>
                  <th className="num">Used in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data?.items.map((item) => (
                  <tr key={item.id}>
                    <td className="muted">{item.id}</td>
                    <td className="q-cell">
                      <button type="button" className="link-btn left" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
                        {expanded === item.id ? item.text : item.text.length > 110 ? `${item.text.slice(0, 110)}…` : item.text}
                      </button>
                      {expanded === item.id && (
                        <ol className="mini-options" type="A">
                          {item.options.map((o, i) => (
                            <li key={i} className={i === item.correct_option ? 'opt-correct' : ''}>
                              {o}
                            </li>
                          ))}
                        </ol>
                      )}
                    </td>
                    <td>{item.category}</td>
                    <td>
                      <DifficultyBadge value={item.difficulty} />
                    </td>
                    <td className="num">{item.marks}</td>
                    <td className="num">{item.used_in}</td>
                    <td className="actions">
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(item)}>
                        Edit
                      </button>
                      <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => remove(item)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={(page) => setFilters({ ...filters, page })} />}
      </div>

      {editing && (
        <QuestionFormModal
          question={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
      {importing && <QuestionImportModal onClose={() => setImporting(false)} onDone={reloadAll} />}
    </div>
  );
}

export function QuestionImportModal({ competitionId, onClose, onDone }) {
  return (
    <CsvImportModal
      title="Import questions from CSV"
      endpoint="/admin/questions/import"
      template={QUESTION_TEMPLATE}
      templateName="questions-template.csv"
      initialExtra={competitionId ? { competitionId } : {}}
      help="Columns: question, option_a … option_f (at least 2), correct (A–F), category, difficulty (easy/medium/hard), marks, explanation, image_url. Save from Excel / Google Sheets as CSV (UTF-8)."
      onClose={onClose}
      onDone={onDone}
    />
  );
}

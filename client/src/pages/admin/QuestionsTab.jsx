import { useRef, useState } from 'react';
import { ConfirmDialog, EmptyState, ErrorBox, Field, Loading, Modal, useToast } from '../../components/ui.jsx';
import { api, fieldErrors, useFetch } from '../../lib/api.js';
import { formatScore } from '../../lib/format.js';

const LETTERS = 'ABCDEF';

const TEMPLATE = [
  'Question,Option A,Option B,Option C,Option D,Correct,Marks,Negative Marks,Explanation',
  '"Which planet is known as the Red Planet?",Venus,Mars,Jupiter,Mercury,B,1,0,Mars looks red because of iron oxide on its surface.',
  '"What is the SI unit of resistance?",Volt,Ampere,Ohm,Watt,C,2,0.5,',
  '"2 + 2 = ?",3,4,,,B,1,0,Questions can have 2 to 6 options (Option E and Option F columns are optional).',
].join('\n');

function downloadTemplate() {
  const blob = new Blob([`﻿${TEMPLATE}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'questions-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function QuestionModal({ competitionId, question, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    text: question?.text ?? '',
    options: question?.options ?? ['', '', '', ''],
    correctOption: question?.correctOption ?? 0,
    marks: String(question?.marks ?? 1),
    negativeMarks: String(question?.negativeMarks ?? 0),
    explanation: question?.explanation ?? '',
  }));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setOption = (i, value) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? value : o)) }));
  const addOption = () => setForm((f) => ({ ...f, options: [...f.options, ''] }));
  const removeOption = (i) =>
    setForm((f) => ({
      ...f,
      options: f.options.filter((_, j) => j !== i),
      correctOption: f.correctOption === i ? 0 : f.correctOption > i ? f.correctOption - 1 : f.correctOption,
    }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    const body = { ...form, marks: Number(form.marks), negativeMarks: Number(form.negativeMarks) };
    try {
      if (question) await api.put(`/admin/questions/${question.id}`, body);
      else await api.post(`/admin/competitions/${competitionId}/questions`, body);
      onSaved(question ? 'Question updated' : 'Question added');
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
      setBusy(false);
    }
  };

  const optionError = Object.entries(errors).find(([k]) => k.startsWith('options'))?.[1];

  return (
    <Modal
      title={question ? 'Edit question' : 'Add question'}
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
      <form id="question-form" onSubmit={save} className="stack" noValidate>
        <ErrorBox error={error} />
        <Field label="Question" error={errors.text} htmlFor="q-text">
          <textarea id="q-text" rows={3} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} required />
        </Field>
        <fieldset className="options-editor">
          <legend>Options — select the correct answer</legend>
          {form.options.map((o, i) => (
            <div key={i} className={`option-edit ${form.correctOption === i ? 'is-correct' : ''}`}>
              <label className="option-edit-radio" title="Mark as correct answer">
                <input type="radio" name="correct" checked={form.correctOption === i} onChange={() => setForm({ ...form, correctOption: i })} />
                <span className="option-key">{LETTERS[i]}</span>
              </label>
              <input value={o} onChange={(e) => setOption(i, e.target.value)} placeholder={`Option ${LETTERS[i]}`} aria-label={`Option ${LETTERS[i]}`} />
              <button type="button" className="icon-btn" onClick={() => removeOption(i)} disabled={form.options.length <= 2} aria-label={`Remove option ${LETTERS[i]}`}>
                ×
              </button>
            </div>
          ))}
          {optionError && <p className="field-error">{optionError}</p>}
          {errors.correctOption && <p className="field-error">{errors.correctOption}</p>}
          {form.options.length < 6 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={addOption}>
              + Add option
            </button>
          )}
        </fieldset>
        <div className="form-grid">
          <Field label="Marks for correct answer" error={errors.marks} htmlFor="q-marks">
            <input id="q-marks" type="number" min={0} step="0.25" value={form.marks} onChange={(e) => setForm({ ...form, marks: e.target.value })} />
          </Field>
          <Field label="Negative marks for wrong answer" error={errors.negativeMarks} hint="0 = no negative marking" htmlFor="q-neg">
            <input id="q-neg" type="number" min={0} step="0.25" value={form.negativeMarks} onChange={(e) => setForm({ ...form, negativeMarks: e.target.value })} />
          </Field>
        </div>
        <Field label="Explanation (optional)" hint="Shown to students in the answer review after the quiz closes." htmlFor="q-exp">
          <textarea id="q-exp" rows={2} value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

export default function QuestionsTab({ competition, onChange }) {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch(`/admin/competitions/${competition.id}/questions`);
  const [editing, setEditing] = useState(null); // null | 'new' | question
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const fileInput = useRef(null);

  const refresh = () => {
    reload();
    onChange();
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setImportResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await api.post(`/admin/competitions/${competition.id}/questions/import`, body);
      toast(`Imported ${res.imported} question(s)`);
      refresh();
    } catch (err) {
      setImportResult(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/questions/${deleting.id}`);
      toast('Question deleted');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  const questions = data?.questions ?? [];
  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="muted">
          {questions.length} question{questions.length === 1 ? '' : 's'} · {formatScore(totalMarks)} total marks
          {competition.questionsPerAttempt && ` · each student gets ${competition.questionsPerAttempt} random questions`}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-ghost" onClick={downloadTemplate}>
            Download CSV template
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            {busy ? 'Working…' : 'Import from CSV'}
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={onImport} />
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add question
          </button>
        </div>
      </div>

      {competition.stats.started > 0 && (
        <div className="alert alert-info">
          Students have already started this quiz. You can still fix typos or the answer key — then use “Recalculate scores” on the
          Results tab. Questions can no longer be deleted.
        </div>
      )}

      {importResult && (
        <div className="alert alert-error" role="alert">
          <div>
            <strong>{importResult.message}</strong>
            {importResult.details?.length > 0 && (
              <ul className="import-errors">
                {importResult.details.map((d, i) => (
                  <li key={i}>{d.row ? `Row ${d.row}: ${d.message}` : d.message}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={() => setImportResult(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : questions.length === 0 ? (
        <EmptyState title="No questions yet">
          Add questions one by one, or download the CSV template, fill it in Excel / Google Sheets, and import it.
        </EmptyState>
      ) : (
        <ol className="question-list">
          {questions.map((q, i) => (
            <li key={q.id} className="card question-item">
              <div className="question-item-head">
                <span className="question-number">{i + 1}</span>
                <p className="prewrap">{q.text}</p>
                <div className="question-item-actions">
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(q)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => setDeleting(q)}>
                    Delete
                  </button>
                </div>
              </div>
              <ul className="option-preview">
                {q.options.map((o, j) => (
                  <li key={j} className={j === q.correctOption ? 'is-correct' : ''}>
                    <span className="option-key">{LETTERS[j]}</span> {o}
                  </li>
                ))}
              </ul>
              <p className="small muted">
                +{formatScore(q.marks)} correct{q.negativeMarks > 0 && ` · −${formatScore(q.negativeMarks)} wrong`}
                {q.explanation && ' · has explanation'}
              </p>
            </li>
          ))}
        </ol>
      )}

      {editing && (
        <QuestionModal
          competitionId={competition.id}
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            toast(message);
            setEditing(null);
            refresh();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete question?"
          message={<p className="prewrap">{deleting.text}</p>}
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}

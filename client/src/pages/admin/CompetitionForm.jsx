import { useState } from 'react';
import { ErrorBox, Field } from '../../components/ui.jsx';
import { fieldErrors } from '../../lib/api.js';
import { fromLocalInput, toLocalInput } from '../../lib/format.js';

function initialForm(c) {
  if (c) {
    return {
      title: c.title,
      description: c.description,
      instructions: c.instructions,
      startsAt: toLocalInput(c.startsAt),
      endsAt: toLocalInput(c.endsAt),
      durationMinutes: String(c.durationMinutes),
      questionsPerAttempt: c.questionsPerAttempt ? String(c.questionsPerAttempt) : '',
      shuffleQuestions: c.shuffleQuestions,
      shuffleOptions: c.shuffleOptions,
      resultsVisibility: c.resultsVisibility,
      isPublished: c.isPublished,
    };
  }
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  start.setMinutes(0, 0, 0);
  return {
    title: '',
    description: '',
    instructions: '',
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(new Date(start.getTime() + 60 * 60 * 1000)),
    durationMinutes: '30',
    questionsPerAttempt: '',
    shuffleQuestions: true,
    shuffleOptions: true,
    resultsVisibility: 'after_end',
    isPublished: false,
  };
}

export default function CompetitionForm({ competition, onSubmit, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => initialForm(competition));
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      await onSubmit({
        ...form,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        durationMinutes: Number(form.durationMinutes),
        questionsPerAttempt: form.questionsPerAttempt ? Number(form.questionsPerAttempt) : null,
      });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const windowMinutes = form.startsAt && form.endsAt ? Math.round((new Date(form.endsAt) - new Date(form.startsAt)) / 60000) : 0;
  const lateJoinWarning = windowMinutes > 0 && Number(form.durationMinutes) > windowMinutes;

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <ErrorBox error={error} />
      <Field label="Title" error={errors.title} htmlFor="title">
        <input id="title" value={form.title} onChange={set('title')} placeholder="e.g. Annual Tech Quiz 2026" required />
      </Field>
      <Field label="Short description" error={errors.description} htmlFor="description">
        <textarea id="description" rows={2} value={form.description} onChange={set('description')} />
      </Field>
      <Field
        label="Instructions for students"
        error={errors.instructions}
        hint="Shown on the competition page before students start."
        htmlFor="instructions"
      >
        <textarea id="instructions" rows={4} value={form.instructions} onChange={set('instructions')} />
      </Field>

      <div className="form-grid">
        <Field label="Quiz opens at" error={errors.startsAt} hint="Students can start from this time." htmlFor="startsAt">
          <input id="startsAt" type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required />
        </Field>
        <Field label="Quiz closes at" error={errors.endsAt} hint="No one can start or answer after this time." htmlFor="endsAt">
          <input id="endsAt" type="datetime-local" value={form.endsAt} onChange={set('endsAt')} required />
        </Field>
        <Field
          label="Time limit per student (minutes)"
          error={errors.durationMinutes}
          hint="The timer starts when each student presses Start."
          htmlFor="durationMinutes"
        >
          <input id="durationMinutes" type="number" min={1} max={600} value={form.durationMinutes} onChange={set('durationMinutes')} required />
        </Field>
        <Field
          label="Questions per student"
          error={errors.questionsPerAttempt}
          hint="Leave empty to give everyone all questions. Set a number to give each student a random subset."
          htmlFor="questionsPerAttempt"
        >
          <input id="questionsPerAttempt" type="number" min={1} value={form.questionsPerAttempt} onChange={set('questionsPerAttempt')} placeholder="All" />
        </Field>
      </div>
      {lateJoinWarning && (
        <div className="alert alert-warning">
          The quiz window ({windowMinutes} min) is shorter than the time limit. Students will be cut off when the quiz closes.
        </div>
      )}

      <Field label="When can students see their results?" error={errors.resultsVisibility} htmlFor="resultsVisibility">
        <select id="resultsVisibility" value={form.resultsVisibility} onChange={set('resultsVisibility')}>
          <option value="after_end">After the quiz closes (recommended)</option>
          <option value="immediate">Score immediately after submitting</option>
          <option value="hidden">Not yet — I will publish them later</option>
        </select>
      </Field>

      <div className="checkbox-row">
        <label className="checkbox">
          <input type="checkbox" checked={form.shuffleQuestions} onChange={set('shuffleQuestions')} />
          Shuffle question order for each student
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.shuffleOptions} onChange={set('shuffleOptions')} />
          Shuffle answer options for each student
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.isPublished} onChange={set('isPublished')} />
          Published (visible to students)
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

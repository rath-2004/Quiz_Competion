import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { ErrorBox, Field, Spinner, toLocalInput, useToast } from '../../components/ui.jsx';

function defaults() {
  const start = new Date(Date.now() + 24 * 3600 * 1000);
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  return {
    title: '',
    description: '',
    rules: '',
    start_time: toLocalInput(start.toISOString()),
    end_time: toLocalInput(end.toISOString()),
    duration_minutes: 30,
    question_count: '',
    shuffle_questions: true,
    shuffle_options: true,
    negative_mark: 0,
    max_tab_switches: '',
    status: 'draft',
    registration_open: true,
    show_result_immediately: false,
    show_answer_review: false,
  };
}

export default function AdminCompetitionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useToast();
  const [form, setForm] = useState(id ? null : defaults());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errors = error?.details ?? {};

  useEffect(() => {
    if (!id) return;
    api(`/admin/competitions/${id}`)
      .then(({ competition: c }) =>
        setForm({
          ...c,
          description: c.description ?? '',
          rules: c.rules ?? '',
          start_time: toLocalInput(c.start_time),
          end_time: toLocalInput(c.end_time),
          question_count: c.question_count ?? '',
          max_tab_switches: c.max_tab_switches ?? '',
        }),
      )
      .catch(setError);
  }, [id]);

  if (!form) return error ? <ErrorBox error={error} /> : <Spinner />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: form.title,
      description: form.description || null,
      rules: form.rules || null,
      start_time: new Date(form.start_time).toISOString(),
      end_time: new Date(form.end_time).toISOString(),
      duration_minutes: Number(form.duration_minutes),
      question_count: form.question_count === '' ? null : Number(form.question_count),
      shuffle_questions: form.shuffle_questions,
      shuffle_options: form.shuffle_options,
      negative_mark: Number(form.negative_mark || 0),
      max_tab_switches: form.max_tab_switches === '' ? null : Number(form.max_tab_switches),
      status: form.status,
      registration_open: form.registration_open,
      show_result_immediately: form.show_result_immediately,
      show_answer_review: form.show_answer_review,
    };
    try {
      const d = id
        ? await api(`/admin/competitions/${id}`, { method: 'PUT', body })
        : await api('/admin/competitions', { method: 'POST', body });
      notify(id ? 'Competition saved' : 'Competition created — now add questions');
      navigate(`/admin/competitions/${d.competition.id}${id ? '' : '?tab=questions'}`);
    } catch (err) {
      setError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  const windowMinutes = (new Date(form.end_time) - new Date(form.start_time)) / 60000;

  return (
    <form className="stack-lg narrow-wide" onSubmit={save}>
      <Link to={id ? `/admin/competitions/${id}` : '/admin/competitions'} className="muted">
        ← Back
      </Link>
      <h1>{id ? 'Edit competition' : 'New competition'}</h1>
      <ErrorBox error={error} />

      <section className="card stack">
        <h2>Basics</h2>
        <Field label="Title" error={errors.title}>
          <input required value={form.title} onChange={set('title')} placeholder="e.g. Inter-College Tech Quiz 2026 — Prelims" />
        </Field>
        <Field label="Description" error={errors.description}>
          <textarea rows={2} value={form.description} onChange={set('description')} />
        </Field>
        <Field label="Rules shown to students before they start" error={errors.rules}>
          <textarea rows={5} value={form.rules} onChange={set('rules')} placeholder={'1. 30 questions in 30 minutes\n2. …'} />
        </Field>
      </section>

      <section className="card stack">
        <h2>Schedule</h2>
        <div className="grid-3">
          <Field label="Opens at" error={errors.start_time}>
            <input type="datetime-local" required value={form.start_time} onChange={set('start_time')} />
          </Field>
          <Field label="Closes at" error={errors.end_time}>
            <input type="datetime-local" required value={form.end_time} onChange={set('end_time')} />
          </Field>
          <Field label="Time per student (minutes)" error={errors.duration_minutes}>
            <input type="number" min="1" required value={form.duration_minutes} onChange={set('duration_minutes')} />
          </Field>
        </div>
        <p className="muted small">
          Students can start any time while the competition is open. Each gets {form.duration_minutes || '?'} minutes, but never past the closing time
          {windowMinutes > 0 && Number(form.duration_minutes) > windowMinutes && <strong className="text-warn"> — the window is shorter than the duration!</strong>}
          . For a fixed-time event, make the window only slightly longer than the duration (e.g. 10 minutes late-join allowance).
        </p>
      </section>

      <section className="card stack">
        <h2>Questions & marking</h2>
        <div className="grid-3">
          <Field label="Questions per student" error={errors.question_count} hint="Blank = all assigned. Smaller than the pool = random subset per student.">
            <input type="number" min="1" value={form.question_count} onChange={set('question_count')} placeholder="All" />
          </Field>
          <Field label="Negative mark per wrong answer" error={errors.negative_mark}>
            <input type="number" min="0" step="0.25" value={form.negative_mark} onChange={set('negative_mark')} />
          </Field>
          <Field label="Tab switches before auto-submit" error={errors.max_tab_switches} hint="Blank = unlimited (still recorded)">
            <input type="number" min="0" value={form.max_tab_switches} onChange={set('max_tab_switches')} placeholder="Unlimited" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.shuffle_questions} onChange={set('shuffle_questions')} />
          <span>Shuffle question order for each student</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.shuffle_options} onChange={set('shuffle_options')} />
          <span>Shuffle answer options for each student</span>
        </label>
      </section>

      <section className="card stack">
        <h2>Visibility</h2>
        <Field label="Status">
          <select value={form.status} onChange={set('status')}>
            <option value="draft">Draft — hidden from students</option>
            <option value="published">Published — visible to students</option>
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.registration_open} onChange={set('registration_open')} />
          <span>Registration open (students can sign up for this competition)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.show_result_immediately} onChange={set('show_result_immediately')} />
          <span>Show each student their score right after they submit (rank stays hidden until you publish results)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={form.show_answer_review} onChange={set('show_answer_review')} />
          <span>
            Show students which answers were right or wrong, with the correct answers and explanations, once you publish
            results. Leave off to show only their score and rank.
          </span>
        </label>
      </section>

      <div className="row gap-sm">
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Saving…' : id ? 'Save changes' : 'Create competition'}
        </button>
        <Link to={id ? `/admin/competitions/${id}` : '/admin/competitions'} className="btn btn-lg">
          Cancel
        </Link>
      </div>
    </form>
  );
}

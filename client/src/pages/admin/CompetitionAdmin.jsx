import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConfirmDialog, ErrorBox, Loading, StateBadge, useToast } from '../../components/ui.jsx';
import { api, useFetch } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import CompetitionForm from './CompetitionForm.jsx';
import ParticipantsTab from './ParticipantsTab.jsx';
import QuestionsTab from './QuestionsTab.jsx';
import ResultsTab from './ResultsTab.jsx';

const TABS = [
  ['questions', 'Questions'],
  ['participants', 'Participants'],
  ['results', 'Results'],
  ['settings', 'Settings'],
];

export default function CompetitionAdmin() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([key]) => key === params.get('tab')) ? params.get('tab') : 'questions';
  const { data, error, loading, reload } = useFetch(`/admin/competitions/${id}`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const c = data.competition;

  const togglePublish = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/competitions/${id}/publish`, { isPublished: !c.isPublished });
      toast(c.isPublished ? 'Competition unpublished' : 'Competition published — students can now see it');
      reload();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/competitions/${id}`);
      toast('Competition deleted');
      navigate('/admin/competitions');
    } catch (err) {
      setActionError(err);
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const save = async (body) => {
    await api.put(`/admin/competitions/${id}`, body);
    toast('Settings saved');
    reload();
  };

  return (
    <>
      <Link to="/admin/competitions" className="back-link">
        ← Competitions
      </Link>
      <div className="page-header">
        <div>
          <div className="title-row">
            <h1>{c.title}</h1>
            <StateBadge state={c.state} />
          </div>
          <p className="muted">
            {formatDateTime(c.startsAt)} → {formatDateTime(c.endsAt)} · {c.durationMinutes} min per student
          </p>
        </div>
        <div className="page-actions">
          {c.isPublished && (
            <Link to={`/competitions/${c.id}`} className="btn" target="_blank" rel="noreferrer">
              View as student ↗
            </Link>
          )}
          <button type="button" className={`btn ${c.isPublished ? '' : 'btn-primary'}`} onClick={togglePublish} disabled={busy}>
            {c.isPublished ? 'Unpublish' : 'Publish'}
          </button>
        </div>
      </div>
      <ErrorBox error={actionError} />

      <div className="stat-strip">
        <span>
          <strong>{c.stats.questions}</strong> questions
        </span>
        <span>
          <strong>{c.stats.registered}</strong> registered
        </span>
        <span>
          <strong>{c.stats.inProgress}</strong> in progress
        </span>
        <span>
          <strong>{c.stats.finished}</strong> submitted
        </span>
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

      {tab === 'questions' && <QuestionsTab competition={c} onChange={reload} />}
      {tab === 'participants' && <ParticipantsTab competition={c} onChange={reload} />}
      {tab === 'results' && <ResultsTab competition={c} />}
      {tab === 'settings' && (
        <>
          <div className="card">
            <CompetitionForm key={c.updatedAt} competition={c} onSubmit={save} submitLabel="Save settings" />
          </div>
          <div className="card danger-zone">
            <h2>Delete competition</h2>
            <p className="muted">This permanently deletes the competition, its questions, registrations and all results.</p>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Delete competition
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this competition?"
          message={
            <p>
              <strong>{c.title}</strong> and its {c.stats.questions} questions, {c.stats.registered} registrations and{' '}
              {c.stats.finished} results will be permanently deleted.
            </p>
          }
          confirmLabel="Delete permanently"
          danger
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </>
  );
}

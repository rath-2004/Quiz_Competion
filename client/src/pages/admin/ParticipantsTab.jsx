import { useEffect, useState } from 'react';
import { AttemptBadge, ConfirmDialog, EmptyState, ErrorBox, Loading, Pagination, useToast } from '../../components/ui.jsx';
import { api, queryString, useFetch } from '../../lib/api.js';
import { formatDateTime, formatScore, yearLabel } from '../../lib/format.js';

export default function ParticipantsTab({ competition, onChange }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [resetting, setResetting] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useFetch(
    `/admin/competitions/${competition.id}/participants${queryString({ search: term, status, page, pageSize: 50 })}`,
  );

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Refresh progress automatically while the quiz is live.
  useEffect(() => {
    if (competition.state !== 'live') return undefined;
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [competition.state, reload]);

  const reset = async () => {
    setBusy(true);
    try {
      await api.del(`/admin/attempts/${resetting.attempt.id}`);
      toast(`${resetting.name} can now retake the quiz`);
      reload();
      onChange();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setResetting(null);
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="filters">
          <input type="search" placeholder="Search name, register no or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search participants" />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="">All registered</option>
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="finished">Submitted</option>
          </select>
        </div>
        {competition.state === 'live' && <span className="muted small">Auto-refreshing every 10 seconds</span>}
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <EmptyState title={term || status ? 'No matching participants' : 'No one has registered yet'} />
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th className="num">Answered</th>
                  <th className="num">Tab switches</th>
                  <th className="num">Score</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.studentId}>
                    <td>
                      <div className="cell-main">{p.name}</div>
                      <div className="cell-sub">{p.registerNo}</div>
                    </td>
                    <td>
                      <div className="cell-main">{p.department}</div>
                      <div className="cell-sub">{yearLabel(p.yearOfStudy)}</div>
                    </td>
                    <td>
                      <AttemptBadge status={p.attempt?.status} />
                    </td>
                    <td className="num">{p.attempt ? `${p.attempt.answered}/${p.attempt.totalQuestions}` : '—'}</td>
                    <td className={`num ${p.attempt?.tabSwitches >= 3 ? 'danger-text' : ''}`}>{p.attempt ? p.attempt.tabSwitches : '—'}</td>
                    <td className="num">
                      {p.attempt?.score !== null && p.attempt?.score !== undefined
                        ? `${formatScore(p.attempt.score)} / ${formatScore(p.attempt.maxScore)}`
                        : '—'}
                    </td>
                    <td className="small">{p.attempt ? formatDateTime(p.attempt.startedAt) : '—'}</td>
                    <td>
                      {p.attempt && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setResetting(p)}>
                          Reset attempt
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </div>
      )}

      {resetting && (
        <ConfirmDialog
          title="Reset this attempt?"
          message={
            <p>
              <strong>{resetting.name}</strong>&apos;s answers and score will be deleted and they can start the quiz again from the
              beginning. Use this only for genuine technical problems.
            </p>
          }
          confirmLabel="Reset attempt"
          danger
          busy={busy}
          onCancel={() => setResetting(null)}
          onConfirm={reset}
        />
      )}
    </div>
  );
}

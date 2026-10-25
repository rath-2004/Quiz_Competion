import { useState } from 'react';
import { ConfirmDialog, EmptyState, ErrorBox, Loading, Pagination, StatCard, useToast } from '../../components/ui.jsx';
import { api, useFetch } from '../../lib/api.js';
import { formatDuration, formatScore, yearLabel } from '../../lib/format.js';

export default function ResultsTab({ competition }) {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [confirmRescore, setConfirmRescore] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useFetch(`/admin/competitions/${competition.id}/results?page=${page}&pageSize=50`);

  const rescore = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/admin/competitions/${competition.id}/rescore`);
      toast(`Recalculated ${res.rescored} result(s)`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
      setConfirmRescore(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const { summary, departments, items, total } = data;

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="muted">
          {total} submitted · ranked by score, then time taken
          {competition.resultsVisibility === 'hidden' && ' · results are hidden from students (change in Settings to publish)'}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn" onClick={() => setConfirmRescore(true)} disabled={!total}>
            Recalculate scores
          </button>
          <a className={`btn btn-primary ${total ? '' : 'disabled'}`} href={`/api/admin/competitions/${competition.id}/results.csv`}>
            Export to Excel (CSV)
          </a>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState title="No submissions yet">Results appear here as soon as students submit.</EmptyState>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Participants" value={total} />
            <StatCard label="Highest score" value={formatScore(summary.highest)} />
            <StatCard label="Average score" value={formatScore(summary.average)} />
            <StatCard label="Average time" value={formatDuration(summary.averageTimeSeconds)} />
          </div>

          <div className="card table-card">
            <h2 className="card-title">Department-wise performance</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th className="num">Participants</th>
                    <th className="num">Average score</th>
                    <th className="num">Top score</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.map((d) => (
                    <tr key={d.department}>
                      <td>{d.department}</td>
                      <td className="num">{d.participants}</td>
                      <td className="num">{formatScore(d.averageScore)}</td>
                      <td className="num">{formatScore(d.topScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card table-card">
            <h2 className="card-title">Rankings</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Department</th>
                    <th className="num">Score</th>
                    <th className="num">Correct / Wrong / Skipped</th>
                    <th className="num">Time</th>
                    <th className="num">Tab switches</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.attemptId} className={r.rank <= 3 ? `podium podium-${r.rank}` : ''}>
                      <td>
                        <span className="rank">{r.rank}</span>
                      </td>
                      <td>
                        <div className="cell-main">{r.name}</div>
                        <div className="cell-sub">
                          {r.registerNo} · {r.phone}
                        </div>
                      </td>
                      <td>
                        <div className="cell-main">{r.department}</div>
                        <div className="cell-sub">{yearLabel(r.yearOfStudy)}</div>
                      </td>
                      <td className="num">
                        <strong>{formatScore(r.score)}</strong> / {formatScore(r.maxScore)}
                      </td>
                      <td className="num">
                        <span className="success-text">{r.correctCount}</span> / <span className="danger-text">{r.wrongCount}</span> /{' '}
                        {r.unansweredCount}
                      </td>
                      <td className="num">
                        {formatDuration(r.timeTakenSeconds)}
                        {r.status === 'auto_submitted' && <div className="cell-sub">time up</div>}
                      </td>
                      <td className={`num ${r.tabSwitches >= 3 ? 'danger-text' : ''}`}>{r.tabSwitches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={total} onChange={setPage} />
          </div>
        </>
      )}

      {confirmRescore && (
        <ConfirmDialog
          title="Recalculate all scores?"
          message={<p>Use this after correcting an answer key or changing marks. Every submitted attempt is re-marked with the current questions.</p>}
          confirmLabel="Recalculate"
          busy={busy}
          onCancel={() => setConfirmRescore(false)}
          onConfirm={rescore}
        />
      )}
    </div>
  );
}

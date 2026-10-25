import { useState } from 'react';
import { api, downloadText, readFileText } from '../api.js';
import { ErrorBox, Field, Modal } from './ui.jsx';

/**
 * Generic CSV upload dialog. `endpoint` receives { csv, ...extra }; `renderExtra` adds fields that fill `extra`.
 */
export function CsvImportModal({ title, endpoint, template, templateName, help, renderExtra, initialExtra = {}, onDone, onClose }) {
  const [file, setFile] = useState(null);
  const [extra, setExtra] = useState(initialExtra);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function upload() {
    if (!file) return setError(new Error('Choose a CSV file first'));
    setBusy(true);
    setError(null);
    try {
      const csv = await readFileText(file);
      const r = await api(endpoint, { method: 'POST', body: { csv, ...extra } });
      setResult(r);
      onDone?.(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        result ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={upload} disabled={busy}>
              {busy ? 'Importing… (large files can take a minute)' : 'Import'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <div className="summary-grid">
            <div>
              <strong>{result.inserted}</strong>
              <span>Imported</span>
            </div>
            {'skipped' in result && (
              <div>
                <strong>{result.skipped}</strong>
                <span>Already existed</span>
              </div>
            )}
            {'registered' in result && extra.competitionId && (
              <div>
                <strong>{result.registered}</strong>
                <span>Registered</span>
              </div>
            )}
            <div>
              <strong>{result.failed}</strong>
              <span>Rows with errors</span>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <div className="table-wrap scroll-y">
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e) => (
                    <tr key={e.row}>
                      <td>{e.row}</td>
                      <td>{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          <ErrorBox error={error} />
          <p className="muted">{help}</p>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => downloadText(templateName, template)}>
              ⬇ Download template
            </button>
          </div>
          <Field label="CSV file">
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0] ?? null)} />
          </Field>
          {renderExtra?.(extra, setExtra)}
        </div>
      )}
    </Modal>
  );
}

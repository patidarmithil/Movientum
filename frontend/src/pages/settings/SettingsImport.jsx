import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { LuCircleCheck, LuDownload, LuFileSpreadsheet } from 'react-icons/lu';
import settingsService from '../../services/settingsService';

const SettingsImport = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleDownloadTemplate = () => {
    const template = "title,type,year,tmdb_id,rating\nInception,movie,2010,27205,go_for_it\nBreaking Bad,tv,2008,1396,perfection\n";
    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "movientum_import_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (selectedFile.type !== 'text/csv' && !selectedFile.name.endsWith('.csv') && selectedFile.type !== 'application/vnd.ms-excel') {
        setError('Please upload a valid CSV file.');
        return;
      }
      setFile(selectedFile);
      setError('');
      setStats(null);
      
      Papa.parse(selectedFile, {
        header: true,
        preview: 10,
        complete: (results) => {
          setPreview(results.data);
        },
        error: (err) => {
          setError('Failed to parse CSV preview: ' + err.message);
        }
      });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      // Simulate an event object for handleFileChange
      handleFileChange({ target: { files: [e.dataTransfer.files[0]] } });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file first.');
      return;
    }

    setLoading(true);
    setError('');
    setStats(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await settingsService.importList(formData);
      setStats(result);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to import list.');
    } finally {
      setLoading(false);
    }
  };

  const onZoneKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-header settings-header--row">
        <div>
          <h1>Import List</h1>
          <p>Import your watch history and ratings from a CSV file.</p>
        </div>
        <button type="button" className="settings-btn settings-btn--ghost" onClick={handleDownloadTemplate}>
          <LuDownload aria-hidden /> Download Template
        </button>
      </div>

      <div className="settings-block">
        <h4 className="settings-subtitle">CSV template structure</h4>
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr><th>title</th><th>type</th><th>year</th><th>tmdb_id <span className="settings-optional">(optional)</span></th><th>rating <span className="settings-optional">(optional)</span></th></tr>
            </thead>
            <tbody>
              <tr><td>Inception</td><td>movie</td><td>2010</td><td>27205</td><td><code>go_for_it</code></td></tr>
              <tr><td>Breaking Bad</td><td>tv</td><td>2008</td><td>1396</td><td><code>perfection</code></td></tr>
              <tr><td>Dune</td><td>movie</td><td>2021</td><td className="settings-muted">blank</td><td className="settings-muted">blank</td></tr>
            </tbody>
          </table>
        </div>
        <p className="settings-help-text">
          <code>tmdb_id</code> is the most accurate match. TMDB reuses the same id for some movies and TV shows,
          so the <code>type</code> column is always checked together with it. If <code>tmdb_id</code> is blank or
          not found, the title and year are used instead.
        </p>
        <p className="settings-help-text">
          <code>type</code> is <code>movie</code> or <code>tv</code>. <code>rating</code> is optional — use{' '}
          <code>skip</code>, <code>timepass</code>, <code>go_for_it</code> or <code>perfection</code>, or leave it
          blank (or remove the column) to import titles as watched without a rating.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div
          className={`settings-dropzone${dragOver ? ' is-over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Choose a CSV file"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={onZoneKey}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv"
            hidden
          />
          <span className="settings-dropzone__icon"><LuFileSpreadsheet aria-hidden /></span>
          {file ? (
            <p>Selected file: <strong>{file.name}</strong></p>
          ) : (
            <p>Tap to choose or drop a CSV file here</p>
          )}
          <small>.csv only</small>
        </div>

        {error && <div className="error-text" role="alert">{error}</div>}

        {preview.length > 0 && !stats && (
          <div className="settings-block">
            <h4 className="settings-subtitle">Preview (first 10 rows)</h4>
            <div className="settings-table-wrap">
              <table className="settings-table">
                <thead>
                  <tr><th>Title</th><th>Type</th><th>Year</th><th>TMDB ID</th><th>Rating</th></tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx}>
                      <td>{row.title || '-'}</td>
                      <td>{row.type || '-'}</td>
                      <td>{row.year || '-'}</td>
                      <td>{row.tmdb_id || '-'}</td>
                      <td><code>{row.rating || '-'}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stats && (
          <div className="settings-result" role="status">
            <h3><LuCircleCheck aria-hidden /> Import complete</h3>
            <ul className="settings-result__stats">
              <li><strong>{stats.imported}</strong> imported</li>
              {stats.rated != null && <li><strong>{stats.rated}</strong> rated</li>}
              {stats.added_to_catalog > 0 && <li><strong>{stats.added_to_catalog}</strong> new titles fetched from TMDB</li>}
              <li><strong>{stats.skipped}</strong> skipped (invalid data)</li>
              <li><strong>{stats.unmatched}</strong> not found</li>
            </ul>
            {stats.unmatched_rows?.length > 0 && (
              <div className="settings-table-wrap">
                <table className="settings-table">
                  <thead>
                    <tr><th>Line</th><th>Title</th><th>Type</th><th>Year</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {stats.unmatched_rows.map((row) => (
                      <tr key={row.line}>
                        <td>{row.line}</td>
                        <td>{row.title || '-'}</td>
                        <td>{row.type || '-'}</td>
                        <td>{row.year || '-'}</td>
                        <td className="settings-muted">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <button type="submit" className="settings-btn" disabled={loading || !file}>
          {loading ? 'Importing...' : 'Start Import'}
        </button>
      </form>
    </div>
  );
};

export default SettingsImport;

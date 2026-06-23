import React, { useState, useRef } from 'react';
import Papa from 'papaparse';
import settingsService from '../../services/settingsService';

const SettingsImport = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const fileInputRef = useRef(null);

  const handleDownloadTemplate = () => {
    const template = "title,type,year,rating\nInception,movie,2010,go_for_it\nBreaking Bad,tv,2008,perfection\n";
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
  };

  const handleDrop = (e) => {
    e.preventDefault();
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

  return (
    <div className="settings-card">
      <div className="settings-header">
        <h1>Import List</h1>
        <p>Import your watch history and ratings from a CSV file.</p>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <button type="button" className="settings-btn" onClick={handleDownloadTemplate} style={{ background: 'var(--surface-input)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          Download Template
        </button>

        <div style={{ marginTop: '1.5rem' }}>
          <h4 style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>CSV Template Structure Example:</h4>
          <div style={{ overflowX: 'auto', background: 'var(--surface-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', maxWidth: '500px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500' }}>title</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500' }}>type</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500' }}>year</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: '500' }}>rating</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>Inception</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>movie</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>2010</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px' }}>go_for_it</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>Breaking Bad</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>tv</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>2008</td>
                  <td style={{ padding: '6px 10px', color: 'var(--text-secondary)' }}>
                    <span style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px' }}>perfection</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div 
          className="settings-form-group" 
          style={{ 
            border: '2px dashed var(--border)', 
            padding: '3rem', 
            textAlign: 'center', 
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            background: 'var(--surface-input)'
          }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".csv" 
            style={{ display: 'none' }} 
          />
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📄</div>
          {file ? (
            <p>Selected file: <strong style={{ color: 'var(--accent)' }}>{file.name}</strong></p>
          ) : (
            <p style={{ color: 'var(--text-secondary)' }}>Click to select or drag and drop a CSV file here</p>
          )}
        </div>

        {error && <div className="error-text" style={{ marginBottom: '1rem' }}>{error}</div>}

        {preview.length > 0 && !stats && (
          <div style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>Preview (First 10 rows)</h3>
            <div style={{ overflowX: 'auto', background: 'var(--surface-input)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '500' }}>Title</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '500' }}>Type</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '500' }}>Year</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: '500' }}>Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{row.title || '-'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{row.type || '-'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{row.year || '-'}</td>
                      <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                        <span style={{ 
                          background: 'rgba(255,255,255,0.1)', 
                          padding: '2px 6px', 
                          borderRadius: '4px' 
                        }}>
                          {row.rating || '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {stats && (
          <div style={{ 
            marginBottom: '2rem', 
            background: 'var(--surface-input)', 
            padding: '1.5rem', 
            borderRadius: 'var(--radius-sm)', 
            border: '1px solid var(--success)' 
          }}>
            <h3 style={{ marginBottom: '1rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              Import Complete!
            </h3>
            <ul style={{ listStyleType: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'var(--text-secondary)' }}>
              <li><strong style={{ color: 'var(--text-primary)' }}>Imported:</strong> {stats.imported} successfully matched and added.</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Skipped:</strong> {stats.skipped} had invalid or missing data.</li>
              <li><strong style={{ color: 'var(--text-primary)' }}>Unmatched:</strong> {stats.unmatched} titles could not be found in our database.</li>
            </ul>
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

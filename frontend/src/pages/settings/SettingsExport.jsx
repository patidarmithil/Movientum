import { useState } from 'react';
import { LuFileSpreadsheet, LuBrainCircuit, LuDownload, LuCircleCheck } from 'react-icons/lu';
import settingsService from '../../services/settingsService';

const EXPORTS = [
  {
    key: 'list',
    Icon: LuFileSpreadsheet,
    title: 'Export list (CSV)',
    desc: 'Every title you watched or rated as title, type, year, TMDB ID and rating — the same format as Import List, so you can re-import it or open it in Excel.',
    points: ['Watched titles', 'Ratings (blank when unrated)', 'Re-importable'],
    cta: 'Download CSV',
    run: settingsService.exportList,
  },
  {
    key: 'full',
    Icon: LuBrainCircuit,
    title: 'Full data export for AI (JSON)',
    desc: 'Everything Movientum knows about your taste in one file, with a built-in guide so ChatGPT, Claude, Gemini or any other AI can read it and recommend titles for you.',
    points: [
      'Profile & preferences',
      'Ratings & watch history',
      'Watchlists & tier lists',
      'Learned taste profile',
      'Recommendation feedback',
      'How-to-use guide for AI',
    ],
    cta: 'Download JSON',
    run: settingsService.exportFull,
  },
];

const SettingsExport = () => {
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');

  const handleExport = async (item) => {
    setBusy(item.key);
    setError('');
    setDone(null);
    try {
      await item.run();
      setDone(item.key);
    } catch {
      setError('Export failed. Please try again in a moment.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-header">
        <h1>Export Data</h1>
        <p>Download a copy of your Movientum data. Files are generated on demand and only contain your own data.</p>
      </div>

      {error && <div className="error-text" role="alert">{error}</div>}

      <div className="settings-export">
        {EXPORTS.map((item) => (
          <section key={item.key} className="settings-export__card">
            <div className="settings-export__head">
              <span className="settings-export__icon"><item.Icon aria-hidden /></span>
              <h2>{item.title}</h2>
            </div>
            <p className="settings-export__desc">{item.desc}</p>
            <ul className="settings-export__points">
              {item.points.map((pt) => <li key={pt}>{pt}</li>)}
            </ul>
            <div className="settings-export__foot">
              <button
                type="button"
                className={`settings-btn${item.key === 'list' ? ' settings-btn--ghost' : ''}`}
                onClick={() => handleExport(item)}
                disabled={busy !== null}
              >
                <LuDownload aria-hidden />
                {busy === item.key ? 'Preparing…' : item.cta}
              </button>
              {done === item.key && (
                <span className="settings-export__ok" role="status">
                  <LuCircleCheck aria-hidden /> Downloaded
                </span>
              )}
            </div>
          </section>
        ))}
      </div>

      <p className="settings-help-text">
        Tip: upload the JSON file to an AI chat and ask “Based on this file, what should I watch next?”
      </p>
    </div>
  );
};

export default SettingsExport;

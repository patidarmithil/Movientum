import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import settingsService from '../../services/settingsService';

const SettingsDeleteAccount = () => {
  const { logout } = useAuth();
  
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (confirmation !== 'DELETE') {
      setError("Please type 'DELETE' to confirm");
      setLoading(false);
      return;
    }

    try {
      await settingsService.deleteAccount({
        password,
        confirmation
      });
      // Logout immediately
      logout();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete account');
      setLoading(false);
    }
  };

  return (
    <div className="settings-card danger-card">
      <div className="settings-header">
        <h1 style={{ color: 'var(--error)' }}>Delete Account</h1>
        <p>
          Once you delete your account, there is no going back. Please be certain.
          This will delete all your ratings, watch history, watchlists, and profile data.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="settings-form-group">
          <label htmlFor="password">Current Password</label>
          <input
            type="password"
            id="password"
            className="settings-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="settings-form-group">
          <label htmlFor="confirmation">To verify, type <b>DELETE</b> below</label>
          <input
            type="text"
            id="confirmation"
            className="settings-input"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
            placeholder="DELETE"
          />
        </div>

        {error && <div className="error-text" style={{ marginBottom: '1rem' }}>{error}</div>}

        <button 
          type="submit" 
          className="settings-btn settings-btn-danger" 
          disabled={loading || confirmation !== 'DELETE' || !password}
        >
          {loading ? 'Deleting...' : 'Delete Account'}
        </button>
      </form>
    </div>
  );
};

export default SettingsDeleteAccount;

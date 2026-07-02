import React, { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import settingsService from '../../services/settingsService';

const SettingsProfile = () => {
  const { user, updateUser } = useAuth();
  
  const [username, setUsername] = useState(user?.username || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [avatar, setAvatar] = useState(null);
  const getAvatarUrl = (path) => {
    if (!path) return '/default-avatar.png';
    if (path.startsWith('http')) return path;
    return `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${path}`;
  };

  const [preview, setPreview] = useState(getAvatarUrl(user?.avatar_url));
  const [imgError, setImgError] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('File size must be under 5MB');
        return;
      }
      setAvatar(file);
      setPreview(URL.createObjectURL(file));
      setImgError(false);
      setError('');
    }
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const formData = new FormData();
      if (username !== user?.username) formData.append('username', username);
      if (bio !== user?.bio) formData.append('bio', bio);
      if (avatar) formData.append('avatar', avatar);

      const updatedUser = await settingsService.updateProfile(formData);
      updateUser(updatedUser);
      setSuccess('Profile updated successfully');
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-header">
        <h1>Edit Profile</h1>
        <p>Update your public profile details and avatar.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="avatar-upload">
          <div className="avatar-preview-wrapper" onClick={handleAvatarClick}>
            {!imgError ? (
              <img 
                src={preview} 
                alt="Avatar" 
                className="avatar-preview" 
                onError={() => setImgError(true)} 
              />
            ) : (
              <div className="avatar-preview-fallback">
                {username ? username[0].toUpperCase() : 'U'}
              </div>
            )}
            <div className="avatar-overlay">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            style={{ display: 'none' }}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Profile Photo</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>JPG, PNG or WEBP. Max 5MB.</div>
          </div>
        </div>

        <div className="settings-form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            className="settings-input"
            value={user?.email || ''}
            disabled
          />
        </div>

        <div className="settings-form-group">
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            className="settings-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={100}
            required
          />
        </div>

        <div className="settings-form-group">
          <label htmlFor="bio">Bio</label>
          <textarea
            id="bio"
            className="settings-input"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={160}
          />
          <div className="char-count">{bio.length} / 160</div>
        </div>

        {error && <div className="error-text" style={{ marginBottom: '1rem' }}>{error}</div>}
        {success && <div className="success-text" style={{ marginBottom: '1rem' }}>{success}</div>}

        <button type="submit" className="settings-btn" disabled={loading}>
          {loading ? 'Saving...' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
};

export default SettingsProfile;

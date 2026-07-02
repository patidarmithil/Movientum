import React from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Settings.css';

const Settings = () => {
  const location = useLocation();
  const { user } = useAuth();

  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    return <Navigate to="/settings/profile" replace />;
  }

  const showOnlyLegalAndHelp = location.pathname.includes('/help') || 
                               location.pathname.includes('/privacy') || 
                               location.pathname.includes('/terms');

  const initials = user
    ? (user.username || user.email || '?').charAt(0).toUpperCase()
    : '?';

  const avatarUrl = user?.avatar_url
    ? (user.avatar_url.startsWith('http') ? user.avatar_url : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${user.avatar_url}`)
    : null;

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
        {user && (
          <div className="settings-user-profile">
            <div className="settings-user-avatar">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={user.username || 'User'}
                  className="settings-avatar-img"
                />
              ) : (
                initials
              )}
            </div>
            <div className="settings-user-info">
              <span className="settings-username">{user.username || 'User'}</span>
              <span className="settings-email">{user.email}</span>
            </div>
          </div>
        )}

        {!showOnlyLegalAndHelp && (
          <>
            <div className="settings-nav-section">
              <div className="settings-nav-label">Account</div>
              <NavLink to="/settings/profile" className="settings-nav-link">Edit Profile</NavLink>
              <NavLink to="/settings/password" className="settings-nav-link">Change Password</NavLink>
              <NavLink to="/settings/delete-account" className="settings-nav-link">Delete Account</NavLink>
            </div>
            <div className="settings-nav-section">
              <div className="settings-nav-label">Content</div>
              <NavLink to="/settings/import" className="settings-nav-link">Import List (CSV)</NavLink>
            </div>
            
            <div className="settings-nav-section">
              <div className="settings-nav-label">Support</div>
              <NavLink to="/settings/feedback" className="settings-nav-link">Submit Feedback</NavLink>
              <NavLink to="/settings/my-issues" className="settings-nav-link">My Issues</NavLink>
            </div>
          </>
        )}

        <div className="settings-nav-section">
          <div className="settings-nav-label">Legal & Help</div>
          <NavLink to="/settings/help" className="settings-nav-link">Help & Tutorials</NavLink>
          <NavLink to="/settings/privacy" className="settings-nav-link">Privacy Policy</NavLink>
          <NavLink to="/settings/terms" className="settings-nav-link">Terms of Service</NavLink>
        </div>
      </aside>
      <main className="settings-content">
        <Outlet />
      </main>
    </div>
  );
};

export default Settings;

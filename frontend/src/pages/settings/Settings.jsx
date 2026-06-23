import React from 'react';
import { NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import './Settings.css';

const Settings = () => {
  const location = useLocation();

  if (location.pathname === '/settings' || location.pathname === '/settings/') {
    return <Navigate to="/settings/profile" replace />;
  }

  return (
    <div className="settings-layout">
      <aside className="settings-sidebar">
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

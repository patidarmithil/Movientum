import React, { useState, useEffect } from 'react';
import './InstallPrompt.css';

export default function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [selectedOS, setSelectedOS] = useState(null); // 'ios' or 'android'

  useEffect(() => {
    const hasSeen = localStorage.getItem('mv:installPromptDismissed');
    if (hasSeen) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    if (isStandalone) return;

    const ua = navigator.userAgent.toLowerCase();
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    if (isIOS) {
      setSelectedOS('ios');
      setShow(true);
    } else if (isAndroid) {
      setSelectedOS('android');
      setShow(true);
    } else {
      // Fallback for mobile width detection
      const checkMobile = () => {
        if (window.innerWidth <= 768) {
          setShow(true);
        } else {
          setShow(false);
        }
      };
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('mv:installPromptDismissed', 'true');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="install-prompt-overlay">
      <div className="install-prompt-modal">
        <button className="install-prompt-close" onClick={handleDismiss} aria-label="Close">&times;</button>
        <h3 className="install-prompt-title">Install Movientum App</h3>
        <p className="install-prompt-desc">Add our site to your home screen to use it as an app.</p>
        
        <div className="install-prompt-os-selector">
          <button 
            className={`install-os-btn ${selectedOS === 'ios' ? 'active' : ''}`}
            onClick={() => setSelectedOS('ios')}
          >
            iPhone (iOS)
          </button>
          <button 
            className={`install-os-btn ${selectedOS === 'android' ? 'active' : ''}`}
            onClick={() => setSelectedOS('android')}
          >
            Android
          </button>
        </div>

        {selectedOS === 'ios' && (
          <div className="install-prompt-steps">
            <h4>iOS (Safari)</h4>
            <ol>
              <li>Go to the website in Safari on your iPhone.</li>
              <li>Tap the <strong>Share</strong> button.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Turn on <strong>Open as Web App</strong> and tap <strong>Add</strong>.</li>
            </ol>
          </div>
        )}

        {selectedOS === 'android' && (
          <div className="install-prompt-steps">
            <h4>Android (Chrome)</h4>
            <ol>
              <li>Open the website in Chrome on your Android.</li>
              <li>Tap the <strong>More</strong> button (three dots) top-right.</li>
              <li>Tap <strong>Add to Home screen</strong>.</li>
              <li>Tap <strong>Add</strong> to confirm.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

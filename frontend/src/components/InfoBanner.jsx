import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './InfoBanner.css';

export default function InfoBanner() {
  const { isLoggedIn, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeBanner, setActiveBanner] = useState(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    const path = location.pathname;
    
    // Check if we should skip due to "Don't show again" (logged-in user)
    const isDismissedPermanent = (bannerId) => {
      if (!isLoggedIn || !user?.username) return false;
      return localStorage.getItem(`mv:dontshow:${user.username}:${bannerId}`) === 'true';
    };

    // Check if we should skip due to session dismissal (guest user)
    const isDismissedSession = (bannerId) => {
      return sessionStorage.getItem(`mv:dismissedGuest:${bannerId}`) === 'true';
    };

    const isDismissed = (bannerId) => {
      return isDismissedPermanent(bannerId) || isDismissedSession(bannerId);
    };

    // Random choice utility (40% probability for "sometimes" to ensure they show up reliably during tests/usage)
    const rollDice = () => Math.random() < 0.4;

    let selectedBanner = null;

    if (path.startsWith('/movies/') || path.startsWith('/tv/')) {
      // More Like This is on Detail Pages
      if (!isLoggedIn && !isDismissed('login-more-like-this') && rollDice()) {
        selectedBanner = 'login-more-like-this';
      }
    } else if (path === '/dashboard') {
      if (!isLoggedIn) {
        const canShowTrack = !isDismissed('dashboard-guest-track');
        const canShowForYou = !isDismissed('dashboard-guest-for-you');
        
        if (canShowTrack && canShowForYou) {
          selectedBanner = rollDice() ? 'dashboard-guest-track' : 'dashboard-guest-for-you';
        } else if (canShowTrack) {
          selectedBanner = 'dashboard-guest-track';
        } else if (canShowForYou) {
          selectedBanner = 'dashboard-guest-for-you';
        }
      }
    } else if (path === '/home' || path === '/home/') {
      if (isLoggedIn) {
        const canShowForYou = !isDismissed('home-for-you-more');
        const canShowExplore = !isDismissed('explore-highlight');
        
        if (canShowForYou && canShowExplore) {
          selectedBanner = rollDice() ? 'home-for-you-more' : 'explore-highlight';
        } else if (canShowForYou) {
          selectedBanner = 'home-for-you-more';
        } else if (canShowExplore) {
          selectedBanner = 'explore-highlight';
        }
      } else {
        if (!isDismissed('explore-highlight') && rollDice()) {
          selectedBanner = 'explore-highlight';
        }
      }
    }

    setActiveBanner(selectedBanner);
    setDontShowAgain(false); // Reset checkbox for new banner

    // Dispatch highlights
    if (selectedBanner === 'explore-highlight') {
      window.dispatchEvent(new CustomEvent('mv:highlightExplore', { detail: true }));
    } else {
      window.dispatchEvent(new CustomEvent('mv:highlightExplore', { detail: false }));
    }

    if (selectedBanner === 'home-for-you-more') {
      window.dispatchEvent(new CustomEvent('mv:highlightForYouSeeAll', { detail: true }));
    } else {
      window.dispatchEvent(new CustomEvent('mv:highlightForYouSeeAll', { detail: false }));
    }

    // Cleanup highlights on location change/unmount
    return () => {
      window.dispatchEvent(new CustomEvent('mv:highlightExplore', { detail: false }));
      window.dispatchEvent(new CustomEvent('mv:highlightForYouSeeAll', { detail: false }));
    };
  }, [location.pathname, isLoggedIn, user]);

  const handleDismiss = () => {
    if (isLoggedIn && user?.username) {
      if (dontShowAgain) {
        localStorage.setItem(`mv:dontshow:${user.username}:${activeBanner}`, 'true');
      }
    } else {
      sessionStorage.setItem(`mv:dismissedGuest:${activeBanner}`, 'true');
    }
    
    // Clean up active highlight classes
    if (activeBanner === 'explore-highlight') {
      window.dispatchEvent(new CustomEvent('mv:highlightExplore', { detail: false }));
    }
    if (activeBanner === 'home-for-you-more') {
      window.dispatchEvent(new CustomEvent('mv:highlightForYouSeeAll', { detail: false }));
    }

    setActiveBanner(null);
  };

  useEffect(() => {
    if (!activeBanner) return;

    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        handleDismiss();
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [activeBanner, dontShowAgain, isLoggedIn, user]);

  if (!activeBanner) return null;

  const handleAction = () => {
    if (activeBanner === 'home-for-you-more') {
      // Scroll to "For You 🎯" section on home page
      const forYouHeader = document.evaluate(
        "//h2[contains(., 'For You')]",
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
      if (forYouHeader) {
        forYouHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        navigate('/recommendations');
      }
    } else if (activeBanner === 'explore-highlight') {
      navigate('/explore');
    } else {
      navigate('/login');
    }
    handleDismiss();
  };

  // Content Map
  const bannerContent = {
    'login-more-like-this': {
      title: 'Get Fresh Recommendations 🎯',
      desc: 'Log in or create an account to get more personalized and fresh suggestions inside "More Like This"!',
      btnText: 'Log In / Sign Up'
    },
    'dashboard-guest-track': {
      title: 'Track Your Watching 📊',
      desc: 'Log in to create watchlists and track your favorite movie and TV content!',
      btnText: 'Log In / Sign Up'
    },
    'dashboard-guest-for-you': {
      title: 'Unlock Personalized Feed 🔮',
      desc: 'Log in to unlock a "For You" section tailored directly to your entertainment tastes!',
      btnText: 'Log In / Sign Up'
    },
    'home-for-you-more': {
      title: 'Want More Suggestions? 🍿',
      desc: 'Click "See All" in the "For You" section to view more recommendations custom-catered to your preferences!',
      btnText: 'See Recommendations'
    },
    'explore-highlight': {
      title: 'Discover New Content 🧭',
      desc: 'Filter out content and find some good movies/shows by visiting our Explore page!',
      btnText: 'Go to Explore'
    }
  };

  const current = bannerContent[activeBanner];

  return (
    <div className="info-banner-overlay">
      <div className="info-banner-modal" ref={modalRef}>
        <button className="info-banner-close" onClick={handleDismiss} aria-label="Close">&times;</button>
        <h3 className="info-banner-title">{current.title}</h3>
        <p className="info-banner-desc">{current.desc}</p>
        
        <div className="info-banner-actions">
          <button className="info-banner-btn" onClick={handleAction}>
            {current.btnText}
          </button>
        </div>

        {isLoggedIn && (
          <div className="info-banner-dontshow">
            <label>
              <input 
                type="checkbox" 
                className="info-banner__checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
              <span>Don't show this again</span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

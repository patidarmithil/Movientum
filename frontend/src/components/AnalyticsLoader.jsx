import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getQueue, setQueue, track } from '../utils/analytics';

export default function AnalyticsLoader() {
  const location = useLocation();
  const previousPath = useRef(null);

  // Avoid duplicate pageviews
  useEffect(() => {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.doNotTrack === "yes") {
      return;
    }

    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;

    track("pageview", {
      url: location.pathname + location.search
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    // Respect browser privacy settings
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.doNotTrack === "yes") {
      return;
    }

    let fallbackPoll = null;

    const stopRetryLoop = () => {
      if (fallbackPoll) clearInterval(fallbackPoll);
    };

    const loadUmami = () => {
      // Use environment variables
      const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID || '5ff5b833-03c6-4c4f-9264-e239a3ea74da';
      const scriptUrl = import.meta.env.VITE_UMAMI_SCRIPT || 'https://umami-analytics-e0d9.onrender.com/script.js';

      // Deduplicate script injection
      if (window.umami) return;
      if (document.querySelector(`script[data-website-id="${websiteId}"]`)) {
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.src = scriptUrl;
      script.setAttribute('data-website-id', websiteId);
      
      const flushQueue = () => {
        if (!window.umami) return;
        
        let queue = getQueue();
        const now = Date.now();
        const FIVE_MIN = 5 * 60 * 1000;
        
        // Flush safely in strict chronological order
        queue.sort((a, b) => a.timestamp - b.timestamp);

        while (queue.length) {
          const event = queue.shift();
          
          // Expire stale events
          if (now - event.timestamp > FIVE_MIN) {
            continue;
          }
          
          try {
            if (event.data) {
              window.umami.track(event.name, event.data);
            } else {
              window.umami.track(event.name);
            }
          } catch (error) {
            // Put it back and stop if it fails
            queue.unshift(event);
            break;
          }
        }
        
        setQueue(queue);
      };

      // Use onload and delay replay slightly
      script.onload = () => {
        setTimeout(flushQueue, 100);
      };

      // Handle ad blockers
      script.onerror = () => {
        console.info("Umami blocked or unavailable.");
        stopRetryLoop();
      };
      
      document.head.appendChild(script);

      // Fallback in case window.umami initializes slightly after onload
      let retries = 0;
      fallbackPoll = setInterval(() => {
        if (window.umami) {
          stopRetryLoop();
          flushQueue();
        } else {
          retries++;
          if (retries >= 30) stopRetryLoop();
        }
      }, 1000);
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(loadUmami);
    } else {
      setTimeout(loadUmami, 5000);
    }

    return () => {
      stopRetryLoop();
    };
  }, []);

  return null;
}

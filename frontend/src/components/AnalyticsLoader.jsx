import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getQueue, setQueue, trackPageView } from '../utils/analytics';

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

    trackPageView(location.pathname + location.search);
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
        
        // 1. Flush pageviews first
        queue.pageviews.sort((a, b) => a.timestamp - b.timestamp);
        while (queue.pageviews.length) {
          const pv = queue.pageviews.shift();
          if (now - pv.timestamp > FIVE_MIN) continue;
          
          try {
            window.umami.track((props) => ({ ...props, url: pv.url }));
          } catch (error) {
            queue.pageviews.unshift(pv);
            break;
          }
        }

        // 2. Flush custom events next
        // Only if pageviews flushed successfully to preserve overall session ordering
        if (queue.pageviews.length === 0) {
          queue.events.sort((a, b) => a.timestamp - b.timestamp);
          while (queue.events.length) {
            const event = queue.events.shift();
            if (now - event.timestamp > FIVE_MIN) continue;
            
            try {
              if (event.data) {
                window.umami.track(event.name, event.data);
              } else {
                window.umami.track(event.name);
              }
            } catch (error) {
              queue.events.unshift(event);
              break;
            }
          }
        }
        
        setQueue(queue);
      };

      // Use onload and delay replay slightly
      script.onload = () => {
        setTimeout(flushQueue, 100);
      };

      // Fallback API implementation for Adblockers
      const setupFallback = () => {
        console.info("Umami script blocked. Using fallback API.");
        const apiUrl = scriptUrl.replace('/script.js', '/api/send');
        
        window.umami = {
          track: (eventName, data) => {
            try {
              const payload = {
                website: websiteId,
                hostname: window.location.hostname,
                language: navigator.language,
                screen: `${window.screen.width}x${window.screen.height}`,
                url: window.location.pathname + window.location.search,
              };

              if (typeof eventName === 'function') {
                Object.assign(payload, eventName(payload));
              } else if (typeof eventName === 'string') {
                payload.name = eventName;
                if (data) payload.data = data;
              }

              fetch(apiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ type: 'event', payload }),
                keepalive: true
              }).catch(() => {});
            } catch (e) {
              console.error("Fallback analytics failed", e);
            }
          }
        };
        flushQueue();
      };

      // Handle ad blockers
      script.onerror = () => {
        stopRetryLoop();
        setupFallback();
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
          if (retries >= 30) {
            stopRetryLoop();
            if (!window.umami) {
              setupFallback();
            }
          }
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

const QUEUE_KEY = 'mv_analytics_queue';
const MAX_QUEUE = 200;
const FIVE_MIN = 5 * 60 * 1000;

export const getQueue = () => {
  try {
    const q = sessionStorage.getItem(QUEUE_KEY);
    if (q) {
      const parsed = JSON.parse(q);
      if (Array.isArray(parsed)) {
        return { pageviews: [], events: [] };
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return { pageviews: [], events: [] };
};

export const setQueue = (queue) => {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
};

const checkPrivacy = () => {
  return navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.doNotTrack === "yes";
};

export const trackPageView = (url) => {
  if (checkPrivacy()) return;

  if (window.umami) {
    // Use Umami's official SPA pageview API
    window.umami.track((props) => ({ ...props, url }));
  } else {
    let queue = getQueue();
    const now = Date.now();
    
    queue.pageviews = queue.pageviews.filter(e => now - e.timestamp < FIVE_MIN);

    queue.pageviews.push({
      url,
      timestamp: now
    });
    
    if (queue.pageviews.length > MAX_QUEUE) {
      queue.pageviews.shift();
    }
    
    setQueue(queue);
  }
};

export const trackEvent = (eventName, data) => {
  if (checkPrivacy()) return;

  if (window.umami) {
    if (data) {
        window.umami.track(eventName, data);
    } else {
        window.umami.track(eventName);
    }
  } else {
    let queue = getQueue();
    const now = Date.now();
    
    queue.events = queue.events.filter(e => now - e.timestamp < FIVE_MIN);

    queue.events.push({
      name: eventName,
      data,
      timestamp: now
    });
    
    if (queue.events.length > MAX_QUEUE) {
      queue.events.shift();
    }
    
    setQueue(queue);
  }
};

// Aliased for backward compatibility if any old code uses track()
export const track = trackEvent;

const QUEUE_KEY = 'mv_analytics_queue';
const MAX_QUEUE = 200;
const FIVE_MIN = 5 * 60 * 1000;

export const getQueue = () => {
  try {
    const q = sessionStorage.getItem(QUEUE_KEY);
    return q ? JSON.parse(q) : [];
  } catch {
    return [];
  }
};

export const setQueue = (queue) => {
  try {
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
};

export const track = (eventName, data) => {
  // Respect browser privacy settings
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.doNotTrack === "yes") {
    return;
  }

  if (window.umami) {
    if (data) {
        window.umami.track(eventName, data);
    } else {
        window.umami.track(eventName);
    }
  } else {
    let queue = getQueue();
    const now = Date.now();
    
    // Expire events during insertion
    queue = queue.filter(e => now - e.timestamp < FIVE_MIN);

    queue.push({
      name: eventName,
      data,
      timestamp: now
    });
    
    // Limit queue size
    if (queue.length > MAX_QUEUE) {
      queue.shift(); // Remove oldest
    }
    
    setQueue(queue);
  }
};

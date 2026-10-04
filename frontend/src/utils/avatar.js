import { BASE_URL as API_BASE } from './api';

/**
 * Avatar resolution shared by every place that renders a user picture.
 *
 * Users with an uploaded photo get that URL (absolute, or relative to the API).
 * Everyone else gets one of 20 gender-neutral emoji avatars from
 * /public/avatars, picked by a stable hash of their id so the same user shows
 * the same face on every page and device — no DB column needed.
 */

const DEFAULT_AVATAR_COUNT = 20;

// FNV-1a — tiny, fast, and spreads short ids evenly across the 20 slots.
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function getDefaultAvatar(user) {
  const seed = String(user?.id || user?.email || user?.username || 'guest');
  const n = (hashString(seed) % DEFAULT_AVATAR_COUNT) + 1;
  return `/avatars/avatar-${String(n).padStart(2, '0')}.svg`;
}

export function getAvatarUrl(user) {
  const path = user?.avatar_url;
  if (!path) return getDefaultAvatar(user);
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

// <img onError> handler: a dead uploaded/Google photo falls back to the
// user's default emoji instead of a broken-image icon.
export function avatarFallback(user) {
  return (e) => {
    const fallback = getDefaultAvatar(user);
    if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback;
  };
}

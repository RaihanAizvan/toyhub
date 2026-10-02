// Fixed-window counters, kept in this process's memory.
//
// The per-account limits in the auth controller stop one account being guessed
// at. They do nothing about one caller walking a list of accounts, so the
// endpoints also count per request source.
//
// This is per process. A deployment running several instances would give each
// one its own count, which is a weaker limit than it looks; sharing the counters
// through the session store or a cache is the fix for that, and is a bigger
// change than it should be bundled into a security fix.

// Counters are pruned when they expire, and the table is capped, so a caller
// rotating source addresses cannot make this grow for ever.
const MAX_KEYS = 10000;
const windows = new Map();

const prune = (now) => {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
    }
  }
};

let lastPrune = 0;

// Counts one attempt against `scope` for `key`.
//
// Returns `allowed: false` once the limit is reached, along with how long is
// left in the window so a caller can be told when to come back.
export const hit = (scope, key, limit, windowMs) => {
  const now = Date.now();
  const id = `${scope}:${key}`;

  if (now - lastPrune > 60000) {
    prune(now);
    lastPrune = now;
    if (windows.size > MAX_KEYS) {
      windows.clear();
    }
  }

  const existing = windows.get(id);
  if (!existing || existing.resetAt <= now) {
    windows.set(id, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    retryAfterMs: existing.resetAt - now,
  };
};

// Forgets one counter, so signing in successfully does not leave a caller
// carrying the failures they made a moment ago.
export const clear = (scope, key) => {
  windows.delete(`${scope}:${key}`);
};

export const resetRateLimits = () => {
  windows.clear();
  lastPrune = 0;
};

// Where a request came from. Express has already decided whether a forwarded
// address is trustworthy, which depends on the trust proxy setting, so this only
// reads `req.ip` and does not go looking through headers itself.
export const requestSource = (req) => {
  const address = req?.ip;
  if (typeof address !== "string" || address.length === 0) {
    return "unknown";
  }
  // ::ffff:127.0.0.1 and 127.0.0.1 are one caller, not two.
  return address.startsWith("::ffff:") ? address.slice(7) : address;
};

// Seconds, for a message that tells somebody when to try again.
export const retryAfterSeconds = (ms) => Math.max(1, Math.ceil(ms / 1000));
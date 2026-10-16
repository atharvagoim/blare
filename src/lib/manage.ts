// Creator-only delete tokens, kept in this browser until the share expires.
const PREFIX = 'vanish:manage:';

interface Entry {
  token: string;
  expiresAt: string;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveManageToken(id: string, token: string, expiresAt: string) {
  try {
    storage()?.setItem(PREFIX + id, JSON.stringify({ token, expiresAt } satisfies Entry));
  } catch {
    /* storage full or blocked — deleting early just won't be available */
  }
}

export function getManageToken(id: string): string | null {
  try {
    const raw = storage()?.getItem(PREFIX + id);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (new Date(entry.expiresAt).getTime() <= Date.now()) {
      storage()?.removeItem(PREFIX + id);
      return null;
    }
    return entry.token;
  } catch {
    return null;
  }
}

export function forgetManageToken(id: string) {
  try {
    storage()?.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
}

export function pruneManageTokens() {
  const s = storage();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const key = s.key(i);
      if (key?.startsWith(PREFIX)) getManageToken(key.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
}

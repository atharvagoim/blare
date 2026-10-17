import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { LiveShare } from '../../shared/limits';
import { logo } from '../design/assets';
import { Img, Pill } from '../design/primitives';
import { Screen } from '../design/Screen';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes } from '../lib/format';
import { forgetManageToken, getManageToken, listManageTokens } from '../lib/manage';

type State = { name: 'loading' } | { name: 'ready'; shares: LiveShare[]; skew: number } | { name: 'error'; message: string };

const KIND_LABEL: Record<LiveShare['kind'], string> = { text: 'Text', image: 'Image', audio: 'Audio', zip: 'Zip' };

function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// Everything you can still manage: links made in this browser, plus your account's links when logged in.
export function LivePage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ name: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Live links · Blare';
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.liveShares(listManageTokens());
      setState({ name: 'ready', shares: res.shares, skew: new Date(res.serverTime).getTime() - Date.now() });
    } catch (err) {
      setState({ name: 'error', message: err instanceof Error ? err.message : 'Could not load your links.' });
    }
  }, []);

  // Wait for the login check so account links are included, and reload when it changes.
  useEffect(() => {
    if (!authLoading) void load();
  }, [authLoading, user?.id, load]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await api.deleteShare(id, getManageToken(id) ?? '');
    } catch {
      /* already gone, or not ours: the refresh below shows the truth */
    }
    forgetManageToken(id);
    setBusyId(null);
    await load();
  }

  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/s/${id}`);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard blocked: the Open link still works */
    }
  }

  const rows = state.name === 'ready' ? state.shares.filter((s) => new Date(s.expiresAt).getTime() - (now + state.skew) > 0) : [];

  return (
    <Screen label="Live links">
      <Img className="logo" src={logo} rect={{ left: 46, top: 66, width: 312, height: 106 }} alt="Blare" />
      <div className="live-scroll" style={{ left: 18, top: 200, width: 368, height: 560 }}>
        {state.name === 'loading' && <p className="live-empty">Loading…</p>}
        {state.name === 'error' && (
          <p className="live-empty is-error">
            {state.message}{' '}
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}
        {state.name === 'ready' && rows.length === 0 && (
          <p className="live-empty">
            No live links right now.
            <br />
            {user ? 'Links you create show up here until they expire.' : <>Links made in this browser show up here. <Link to="/login">Login</Link> to see them on any device.</>}
          </p>
        )}
        {state.name === 'ready' &&
          rows.map((s) => {
            const left = new Date(s.expiresAt).getTime() - (now + state.skew);
            return (
              <article className="live-card" key={s.id}>
                <div className="live-main">
                  <span className="live-name">{s.fileName ?? 'Text snippet'}</span>
                  <span className="live-meta">
                    {KIND_LABEL[s.kind]}
                    {s.size ? ` · ${formatBytes(s.size)}` : ''} · {s.visibility === 'private' ? 'Private' : 'Public'}
                  </span>
                </div>
                <span className={`live-time${left < 60_000 ? ' is-low' : ''}`} aria-label="Time left">
                  {timeLeft(left)}
                </span>
                <button
                  type="button"
                  className="live-trash"
                  aria-label={`Delete ${s.fileName ?? 'text snippet'}`}
                  title="Delete"
                  onClick={() => void remove(s.id)}
                  disabled={busyId === s.id}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3.5 6.5h17" />
                    <path d="M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    <path d="M5.8 6.5l.9 12.2a2 2 0 0 0 2 1.8h6.6a2 2 0 0 0 2-1.8l.9-12.2" />
                    <path d="M10 10.5v6M14 10.5v6" />
                  </svg>
                </button>
                <div className="live-actions">
                  <Link className="live-btn" to={`/s/${s.id}`}>
                    Open
                  </Link>
                  <button type="button" className="live-btn" onClick={() => void copy(s.id)}>
                    {copied === s.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </article>
            );
          })}
      </div>

      <Pill variant="black" rect={{ left: 113, top: 780, width: 176, height: 41 }} label="Create new" onClick={() => navigate('/')} />
    </Screen>
  );
}

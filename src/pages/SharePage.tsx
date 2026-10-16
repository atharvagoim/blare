import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { OTP_LENGTH, type LockedShareView, type ShareView } from '../../shared/limits';
import { copyIcon, crying, dog, logo, privateImage, shareIcon } from '../design/assets';
import { Img, Pill, T, type Rect } from '../design/primitives';
import { Screen } from '../design/Screen';
import { ApiError, api, isLocked } from '../lib/api';
import { forgetManageToken, getManageToken } from '../lib/manage';
import { useQr } from '../lib/qr';

type State =
  | { name: 'loading' }
  | { name: 'locked'; view: LockedShareView }
  | { name: 'ready'; view: ShareView }
  | { name: 'gone' }
  | { name: 'error'; message: string };

const ID_RE = /^[A-Za-z0-9_-]{22}$/;

export function SharePage() {
  const { id = '' } = useParams();
  const [state, setState] = useState<State>(ID_RE.test(id) ? { name: 'loading' } : { name: 'gone' });

  const load = useCallback(async () => {
    try {
      const view = await api.getShare(id, getManageToken(id));
      setState(isLocked(view) ? { name: 'locked', view } : { name: 'ready', view });
      return view;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) setState({ name: 'gone' });
      else setState({ name: 'error', message: err instanceof Error ? err.message : 'Could not load this link.' });
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (ID_RE.test(id)) void load();
  }, [id, load]);

  // Expiry is enforced by the server; this just flips the open page to the expired screen on time.
  const expiresAt = state.name === 'ready' || state.name === 'locked' ? state.view : null;
  useEffect(() => {
    if (!expiresAt) return;
    const skew = new Date(expiresAt.serverTime).getTime() - Date.now();
    const ms = new Date(expiresAt.expiresAt).getTime() - (Date.now() + skew);
    const t = window.setTimeout(() => setState({ name: 'gone' }), Math.max(0, ms) + 250);
    return () => window.clearTimeout(t);
  }, [expiresAt]);

  useEffect(() => {
    document.title = state.name === 'gone' ? 'Link expired · share' : 'share';
  }, [state.name]);

  switch (state.name) {
    case 'loading':
      return (
        <Screen decor={['cactus', 'sunflower']} label="Loading">
          <Img className="logo" src={logo} rect={{ left: 46, top: 87, width: 312, height: 106 }} alt="Blare" />
        </Screen>
      );
    case 'gone':
      return <Expired />;
    case 'error':
      return (
        <Screen decor={['cactus', 'sunflower']} label="Error">
          <Img className="logo" src={logo} rect={{ left: 46, top: 87, width: 312, height: 106 }} alt="Blare" />
          <p className="status is-error" role="alert" style={{ top: 240 }}>
            {state.message}
          </p>
          <Pill variant="black" rect={{ left: 126, top: 300, width: 148, height: 41 }} label="Try again" onClick={() => void load()} />
        </Screen>
      );
    case 'locked':
      return <PrivateFile view={state.view} onUnlocked={load} onGone={() => setState({ name: 'gone' })} />;
    case 'ready':
      return <Ready view={state.view} onGone={() => setState({ name: 'gone' })} />;
  }
}

// ---------------------------------------------------------------------------
// Figma "iPhone 17 - 5": The Link has expired :(
// ---------------------------------------------------------------------------

export function Expired() {
  const navigate = useNavigate();
  return (
    <Screen decor={['cactus', 'sunflower-expired']} label="Link expired">
      <div className="abs" style={{ left: 73, top: 103, width: 256, height: 256, borderRadius: 20, overflow: 'hidden' }}>
        <img className="img-cover" src={dog} alt="" />
      </div>
      <div className="abs" style={{ left: 284, top: 313, width: 61, height: 61, borderRadius: '50%', overflow: 'hidden' }}>
        <img src={crying} alt="" style={{ position: 'absolute', height: '110.28%', left: '-11.83%', top: '-3.53%', width: '126.88%', maxWidth: 'none' }} />
      </div>
      <T as="h1" cx={201} top={395} size={25}>
        The Link has expired :(
      </T>
      <Pill variant="black" rect={{ left: 118, top: 467, width: 166, height: 41 }} label="Create new Link" onClick={() => navigate('/')} />
      <Img className="logo" src={logo} rect={{ left: 45, top: 529, width: 312, height: 106 }} alt="Blare" />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Ready: text (frame 2), image (frame 4), Zip (frame 3), audio (frame 2 layout)
// ---------------------------------------------------------------------------

interface Layout {
  download: Rect & { cx: number; label: string };
  share: Rect & { textCx: number; textTop: number; iconLeft: number; iconTop: number };
  del: Rect & { cx: number };
  qr: Rect;
}

const LAYOUT_TEXT: Layout = {
  download: { left: 43, top: 471, width: 148, height: 41, cx: 117, label: 'Download' },
  share: { left: 43, top: 522, width: 148, height: 39, textCx: 104, textTop: 528, iconLeft: 92, iconTop: 10 },
  del: { left: 44, top: 570, width: 148, height: 39, cx: 117 },
  qr: { left: 220, top: 483, width: 122, height: 122 },
};

const LAYOUT_IMAGE: Layout = {
  download: { left: 46, top: 583, width: 148, height: 41, cx: 120, label: 'Download' },
  share: { left: 45, top: 634, width: 148, height: 39, textCx: 106, textTop: 640, iconLeft: 92, iconTop: 10 },
  del: { left: 47, top: 682, width: 148, height: 39, cx: 120 },
  qr: { left: 220, top: 595, width: 122, height: 122 },
};

const LAYOUT_ZIP: Layout = {
  download: { left: 96, top: 319, width: 207, height: 41, cx: 199, label: 'Download file' },
  share: { left: 128, top: 371, width: 148, height: 39, textCx: 189, textTop: 376, iconLeft: 92, iconTop: 9 },
  del: { left: 126, top: 418, width: 148, height: 39, cx: 199 },
  qr: { left: 137, top: 480, width: 122, height: 122 },
};

function Ready({ view, onGone }: { view: ShareView; onGone: () => void }) {
  const url = `${window.location.origin}/s/${view.id}`;
  const qr = useQr(url);
  const [shareLabel, setShareLabel] = useState('Share');
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const layout = view.kind === 'image' ? LAYOUT_IMAGE : view.kind === 'zip' ? LAYOUT_ZIP : LAYOUT_TEXT;

  async function share() {
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'share', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareLabel('Link copied');
      later(() => setShareLabel('Share'), 1800);
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') setError('Could not share the link. Copy it from the address bar.');
    }
  }

  async function download() {
    setError(null);
    if (view.kind === 'text') {
      const blob = new Blob([view.text ?? ''], { type: 'text/plain;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `share-${view.id.slice(0, 8)}.txt`;
      a.click();
      later(() => URL.revokeObjectURL(href), 1000);
      return;
    }
    // Fresh, short-lived URL right before downloading.
    try {
      const fresh = await api.getShare(view.id, getManageToken(view.id));
      if (!isLocked(fresh) && fresh.downloadUrl) window.location.assign(fresh.downloadUrl);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) onGone();
      else setError(err instanceof Error ? err.message : 'Download failed.');
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(view.text ?? '');
      setCopied(true);
      later(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed. Select the text and copy it manually.');
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteShare(view.id, getManageToken(view.id) ?? '');
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 404 || err.status === 410))) {
        setDeleting(false);
        setError(err instanceof Error ? err.message : 'Could not delete this link.');
        return;
      }
    }
    forgetManageToken(view.id);
    onGone();
  }

  const statusTop = layout.del.top + layout.del.height + (view.kind === 'zip' ? 140 : 24);

  return (
    <Screen decor={['cactus', 'sunflower']} label="Shared file">
      <Img className="logo" src={logo} rect={{ left: 46, top: 87, width: 312, height: 106 }} alt="Blare" />

      {view.kind === 'image' && (
        <a className="box" href={view.previewUrl} target="_blank" rel="noreferrer noopener" style={{ left: 18, top: 217, width: 368, height: 342, display: 'block' }} aria-label={`Open ${view.fileName ?? 'image'} full size`}>
          <img className="img-cover" src={view.previewUrl} alt={view.fileName ?? 'Shared image'} />
        </a>
      )}

      {view.kind === 'text' && (
        <div className="box" style={{ left: 18, top: 217, width: 368, height: 220 }}>
          <pre
            tabIndex={0}
            aria-label="Shared text"
            style={{
              position: 'absolute',
              inset: 0,
              margin: 0,
              padding: '20px 52px 20px 22px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              fontFamily: 'var(--inter)',
              fontWeight: 500,
              fontSize: 16,
              lineHeight: 1.5,
              color: 'var(--drop-title)',
              outline: 'none',
            }}
          >
            {view.text}
          </pre>
          <button
            type="button"
            onClick={copyText}
            aria-label={copied ? 'Copied' : 'Copy text'}
            title={copied ? 'Copied' : 'Copy text'}
            className="abs"
            style={{ left: 321, top: 17, width: 25, height: 25, padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}
          >
            <img src={copyIcon} alt="" width={25} height={25} style={{ display: 'block', transform: 'scaleX(-1)', opacity: copied ? 0.35 : 1, transition: 'opacity 150ms' }} />
          </button>
        </div>
      )}

      {view.kind === 'audio' && (
        <div className="box" style={{ left: 18, top: 217, width: 368, height: 220 }}>
          <T cx={181} top={62} size={19} width={320} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {view.fileName}
          </T>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls preload="metadata" src={view.previewUrl} style={{ position: 'absolute', left: 21, top: 110, width: 320 }} />
        </div>
      )}

      {view.kind === 'zip' && (
        <T as="h1" cx={202} top={273} size={19} width={360} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {view.fileName}
        </T>
      )}

      <Pill variant="black" rect={layout.download} label={layout.download.label} labelCx={layout.download.cx - layout.download.left} onClick={download} />

      <button
        type="button"
        className="pill pill-outline"
        style={{ left: layout.share.left, top: layout.share.top, width: layout.share.width, height: layout.share.height }}
        onClick={share}
        aria-live="polite"
      >
        <img
          src={shareIcon}
          alt=""
          width={18}
          height={18}
          style={{ position: 'absolute', left: layout.share.iconLeft - 2, top: layout.share.iconTop - 2, display: shareLabel === 'Share' ? 'block' : 'none' }}
        />
        <span
          className="label"
          style={{
            top: layout.share.textTop - layout.share.top - 2,
            left: (shareLabel === 'Share' ? layout.share.textCx - layout.share.left : layout.share.width / 2) - 2 - 136,
            right: 'auto',
            width: 272,
            textAlign: 'center',
          }}
        >
          {shareLabel}
        </span>
      </button>

      {view.canDelete && (
        <Pill variant="red" rect={layout.del} label={deleting ? 'Deleting…' : 'Delete'} labelTop={6} labelCx={layout.del.cx - layout.del.left} onClick={remove} disabled={deleting} />
      )}

      {qr && <img className="abs" src={qr} alt="QR code for this link" width={122} height={122} style={{ ...layout.qr, imageRendering: 'pixelated' }} />}

      {error && (
        <p className="status is-error" role="alert" style={{ top: statusTop }}>
          <span className="bg">{error}</span>
        </p>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Figma "iPhone 17 - 8": Private file !  (PIN emailed to the owner account)
// ---------------------------------------------------------------------------

function PrivateFile({ view, onUnlocked, onGone }: { view: LockedShareView; onUnlocked: () => Promise<ShareView | LockedShareView | null>; onGone: () => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; resend?: boolean } | null>(null);
  const sent = useRef(false);

  const sendPin = useCallback(async () => {
    try {
      await api.requestOtp(view.id);
      setStatus({ text: 'We emailed a PIN to the owner of this file.' });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) return onGone();
      if (err instanceof ApiError && err.status === 429) return setStatus({ text: 'A PIN was emailed to the owner recently. Check the inbox.' });
      setStatus({ text: err instanceof Error ? err.message : 'Could not send the PIN.', error: true, resend: true });
    }
  }, [view.id, onGone]);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void sendPin();
  }, [sendPin]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!new RegExp(`^\\d{${OTP_LENGTH}}$`).test(pin)) return setStatus({ text: `Enter the ${OTP_LENGTH}-digit PIN from the email.`, error: true });
    setBusy(true);
    setStatus(null);
    try {
      await api.verifyOtp(view.id, pin);
      const unlocked = await onUnlocked();
      if (unlocked && !isLocked(unlocked) && unlocked.kind !== 'text' && unlocked.downloadUrl) {
        window.location.assign(unlocked.downloadUrl);
      }
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && (err.status === 410 || err.status === 404)) return onGone();
      const locked = err instanceof ApiError && err.code === 'otp_locked';
      setStatus({ text: err instanceof Error ? err.message : 'That PIN is not valid.', error: true, resend: locked });
    }
  }

  return (
    <Screen decor={['cactus', 'sunflower']} label="Private file">
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 46, top: 87, width: 312, height: 106 }} alt="Blare" />
        <T as="h1" cx={202} top={221} size={19}>
          Private file !
        </T>
        <div className="abs" style={{ left: 33, top: 268, width: 339, height: 191, borderRadius: 20, overflow: 'hidden' }}>
          <img className="img-cover" src={privateImage} alt="" />
        </div>

        <div className="field" style={{ left: 107, top: 489, width: 187, height: 49, borderWidth: 2 }}>
          <label htmlFor="pin" className="visually-hidden">
            PIN
          </label>
          <input
            id="pin"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={OTP_LENGTH}
            placeholder="PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
            style={{ textAlign: 'center', fontSize: 20, paddingTop: 8, paddingBottom: 0, paddingLeft: 2, paddingRight: 0, letterSpacing: pin ? '0.18em' : 0 }}
          />
        </div>

        <Pill
          type="submit"
          variant="black"
          rect={{ left: 99, top: 552, width: 207, height: 41 }}
          label={busy ? 'Checking…' : 'Download file'}
          labelCx={202 - 99}
          disabled={busy}
        />

        {status && (
          <p className={`status ${status.error ? 'is-error' : ''}`} role={status.error ? 'alert' : 'status'} style={{ top: 606 }}>
            <span className="bg">
              {status.text}{' '}
              {status.resend && (
                <button type="button" onClick={() => void sendPin()}>
                  Send a new PIN
                </button>
              )}
            </span>
          </p>
        )}
      </form>
    </Screen>
  );
}

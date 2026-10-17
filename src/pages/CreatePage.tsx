import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ACCEPT_ATTRIBUTE, DEFAULT_EXPIRY_SECONDS, EXPIRY_OPTIONS, LARGE_FILE_BYTES, LARGE_FILE_MAX_TTL_SECONDS, MAX_FILE_BYTES, MAX_TEXT_CHARS, PIN_LENGTH, classifyFileName } from '../../shared/limits';
import { TURNSTILE_SITE_KEY, Turnstile } from '../components/Turnstile';
import { logo } from '../design/assets';
import { Img, Pill, T } from '../design/primitives';
import { Screen } from '../design/Screen';
import { ApiError, api, uploadToStorage } from '../lib/api';
import { formatBytes } from '../lib/format';
import { saveManageToken } from '../lib/manage';

type Mode = 'file' | 'text';
type Status = { kind: 'error'; message: string } | null;

// Figma frame "iPhone 17 - 1"
export function CreatePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [ttl, setTtl] = useState<number>(DEFAULT_EXPIRY_SECONDS);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [pin, setPin] = useState('');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<null | { label: string; progress?: number }>(null);
  const [dragOver, setDragOver] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const [turnstileReset, setTurnstileReset] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = 'Blare';
    return () => abortRef.current?.abort();
  }, []);

  const isLarge = mode === 'file' && !!file && file.size > LARGE_FILE_BYTES;

  function pickFile(f: File | null | undefined) {
    setStatus(null);
    if (!f) return;
    if (!classifyFileName(f.name)) return setStatus({ kind: 'error', message: 'That file type isn’t supported. Choose an image, audio or Zip file.' });
    if (f.size === 0) return setStatus({ kind: 'error', message: 'That file is empty.' });
    if (f.size > MAX_FILE_BYTES) return setStatus({ kind: 'error', message: `That file is ${formatBytes(f.size)}. The limit is 500MB.` });
    if (f.size > LARGE_FILE_BYTES) setTtl((t) => Math.min(t, LARGE_FILE_MAX_TTL_SECONDS));
    setFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!busy && mode === 'file') pickFile(e.dataTransfer.files?.[0]);
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setStatus(null);
    if (mode === 'file' && !file) return setStatus({ kind: 'error', message: 'Choose a file to share.' });
    if (mode === 'text' && !text.trim()) return setStatus({ kind: 'error', message: 'Write some text to share.' });
    if (visibility === 'private' && pin.length !== PIN_LENGTH) return setStatus({ kind: 'error', message: `Choose a ${PIN_LENGTH}-digit PIN for the private link.` });
    if (TURNSTILE_SITE_KEY && !turnstileToken) return setStatus({ kind: 'error', message: 'Complete the verification check first.' });

    try {
      setBusy({ label: mode === 'file' ? 'Uploading 0%' : 'Creating…', progress: mode === 'file' ? 0 : undefined });
      const res = await api.createShare({
        type: mode,
        text: mode === 'text' ? text : undefined,
        file: mode === 'file' && file ? { name: file.name, size: file.size, mime: file.type } : undefined,
        ttlSeconds: ttl,
        visibility,
        pin: visibility === 'private' ? pin : undefined,
        turnstileToken,
      });
      let expiresAt = res.expiresAt;
      if (mode === 'file' && file && res.upload) {
        const controller = new AbortController();
        abortRef.current = controller;
        await uploadToStorage(
          res.upload.url,
          res.upload.headers,
          file,
          (p) => setBusy({ label: `Uploading ${Math.round(p * 100)}%`, progress: p }),
          controller.signal,
        );
        setBusy({ label: 'Checking…', progress: 1 });
        expiresAt = (await api.completeShare(res.id, res.manageToken)).expiresAt;
      }
      if (!expiresAt) throw new ApiError(500, 'unknown', 'Something went wrong. Please try again.');
      saveManageToken(res.id, res.manageToken, expiresAt);
      navigate(`/s/${res.id}`);
    } catch (err) {
      setBusy(null);
      setTurnstileReset((n) => n + 1);
      if (err instanceof ApiError && err.code === 'aborted') return;
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong. Please try again.' });
    } finally {
      abortRef.current = null;
    }
  }

  const fileKind = file ? classifyFileName(file.name)?.kind : null;

  return (
    <Screen
      label="Create a link"
      topRight={
        <Link to="/live" className="live-pill" aria-label="Live links">
          Live links
        </Link>
      }
    >
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 66, top: 60, width: 270, height: 100 }} alt="Blare" />

        {/* File / Text switch */}
        <button
          type="button"
          role="switch"
          aria-checked={mode === 'text'}
          aria-label="Share text instead of a file"
          className="mode-switch"
          style={{ left: 162, top: 196, width: 78, height: 32 }}
          onClick={() => !busy && setMode((m) => (m === 'file' ? 'text' : 'file'))}
        >
          <span className="mode-knob" />
          <span className="mode-label" style={mode === 'file' ? { left: 32, right: 0, justifyContent: 'center' } : { left: 0, right: 32, justifyContent: 'center' }}>
            {mode === 'file' ? 'File' : 'Text'}
          </span>
        </button>

        {/* Drop box / text box */}
        <div
          className="box"
          style={{ left: 22, top: 258, width: 358, height: 214, background: dragOver ? 'rgba(255,255,255,0.14)' : undefined }}
          onDragOver={(e) => {
            e.preventDefault();
            if (mode === 'file') setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {mode === 'file' ? (
            <label style={{ position: 'absolute', inset: 0, cursor: busy ? 'default' : 'pointer' }}>
              <input
                type="file"
                accept={ACCEPT_ATTRIBUTE}
                disabled={!!busy}
                onChange={(e) => pickFile(e.target.files?.[0])}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'inherit' }}
              />
              <span className="t" style={{ left: 29, top: 80, width: 300, fontSize: 17, fontWeight: 400, color: 'var(--faint)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {file ? file.name : 'Drop a File or Choose one'}
              </span>
              <span className="t" style={{ left: 29, top: 106, width: 300, fontSize: 13, color: 'var(--muted)' }}>
                {file
                  ? `${fileKind === 'zip' ? 'Zip file' : fileKind === 'audio' ? 'Audio' : 'Image'}, ${formatBytes(file.size)}${isLarge ? ' · 15 min max' : ''} · tap to change`
                  : 'Images, audio or Zip files upto 500MB'}
              </span>
            </label>
          ) : (
            <>
              <label htmlFor="share-text" className="visually-hidden">
                Text to share
              </label>
              <textarea
                id="share-text"
                value={text}
                maxLength={MAX_TEXT_CHARS}
                disabled={!!busy}
                onChange={(e) => setText(e.target.value)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: 0,
                  outline: 'none',
                  resize: 'none',
                  padding: '22px 24px',
                  background: 'transparent',
                  fontFamily: 'var(--font)',
                  fontWeight: 400,
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: 'var(--fg-soft)',
                }}
              />
              {!text && (
                <span className="t" style={{ left: 29, top: 94, width: 300, fontSize: 17, fontWeight: 400, color: 'var(--faint)' }}>
                  Type or paste your text
                </span>
              )}
            </>
          )}
        </div>

        {/* Duration */}
        <div className="glass-select" style={{ left: 22, top: 498, width: 358, height: 42 }}>
          <select aria-label="Duration" value={ttl} disabled={!!busy} onChange={(e) => setTtl(Number(e.target.value))}>
            {EXPIRY_OPTIONS.filter((o) => !isLarge || o.seconds <= LARGE_FILE_MAX_TTL_SECONDS).map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Link type */}
        <div className="glass-select" style={{ left: 22, top: 556, width: 358, height: 42 }}>
          <select aria-label="Link type" value={visibility} disabled={!!busy} onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </div>

        {/* PIN (private links only) */}
        {visibility === 'private' && (
          <>
            <T cx={201} top={620} size={15} color="var(--fg-soft)" width={200}>
              Set pin
            </T>
            <div className="pin-field" style={{ left: 139, top: 648, width: 124, height: 38 }}>
              <label htmlFor="link-pin" className="visually-hidden">
                {PIN_LENGTH}-digit PIN for the receiver
              </label>
              <input
                id="link-pin"
                inputMode="numeric"
                autoComplete="off"
                maxLength={PIN_LENGTH}
                placeholder="····"
                value={pin}
                disabled={!!busy}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
              />
            </div>
          </>
        )}

        <Pill
          type="submit"
          variant="black"
          rect={{ left: 129, top: 730, width: 144, height: 40 }}
          label={busy?.label ?? 'Create Link'}
          labelTop={9}
          disabled={!!busy && busy.progress === undefined}
          progress={busy?.progress}
          onClick={busy?.progress !== undefined && busy.progress < 1 ? () => abortRef.current?.abort() : undefined}
          ariaLabel={busy?.progress !== undefined && busy.progress < 1 ? `${busy.label}. Activate to cancel.` : undefined}
        />

        {TURNSTILE_SITE_KEY && (
          <div className="abs" style={{ left: 36, top: 784 }}>
            <Turnstile onToken={setTurnstileToken} resetKey={turnstileReset} />
          </div>
        )}

        {status && (
          <p className={`status ${status.kind === 'error' ? 'is-error' : ''}`} role="alert" style={{ top: 782 }}>
            <span className="bg">{status.message}</span>
          </p>
        )}
      </form>
    </Screen>
  );
}

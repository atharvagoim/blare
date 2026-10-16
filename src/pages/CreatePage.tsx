import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ACCEPT_ATTRIBUTE, DEFAULT_EXPIRY_SECONDS, EXPIRY_OPTIONS, LARGE_FILE_BYTES, LARGE_FILE_MAX_TTL_SECONDS, MAX_FILE_BYTES, MAX_TEXT_CHARS, PIN_LENGTH, classifyFileName } from '../../shared/limits';
import { TURNSTILE_SITE_KEY, Turnstile } from '../components/Turnstile';
import { liveSign, logo, radioOff, radioOn, selectFrame } from '../design/assets';
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
    document.title = 'share';
    return () => abortRef.current?.abort();
  }, []);

  // The Private row grows to hold the PIN field, pushing the button and messages down.
  const pinShift = visibility === 'private' ? 53 : 0;
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
      decor={['cactus', 'sunflower']}
      label="Create a link"
      topRight={
        <Link to="/live" className="live-sign" aria-label="Live links" title="Live links">
          <img src={liveSign} alt="" draggable={false} />
        </Link>
      }
    >
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 46, top: 66, width: 312, height: 106 }} alt="Blare" />

        {/* File / Text toggle */}
        <div className="abs" role="group" aria-label="What are you sharing?" style={{ left: 142, top: 192, width: 130, height: 31 }}>
          <div className="abs" style={{ inset: 0, background: '#000', borderRadius: 50 }} />
          <div
            className="abs"
            style={{
              top: 0,
              left: mode === 'file' ? 0 : 65,
              width: 65,
              height: 31,
              background: '#fff',
              border: '2px solid #000',
              borderRadius: 50,
              transition: 'left 180ms ease',
            }}
          />
          <button
            type="button"
            aria-pressed={mode === 'file'}
            onClick={() => !busy && setMode('file')}
            className="abs"
            style={{ left: 0, top: 0, width: 65, height: 31, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          >
            <span className="visually-hidden">File</span>
          </button>
          <button
            type="button"
            aria-pressed={mode === 'text'}
            onClick={() => !busy && setMode('text')}
            className="abs"
            style={{ left: 65, top: 0, width: 65, height: 31, background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
          >
            <span className="visually-hidden">Text</span>
          </button>
        </div>
        <T cx={175} top={194} size={18} width={98} color={mode === 'file' ? '#000' : '#fff'} style={{ transition: 'color 180ms' }}>
          File
        </T>
        <T cx={237} top={194} size={18} width={98} color={mode === 'text' ? '#000' : '#fff'} style={{ transition: 'color 180ms' }}>
          Text
        </T>

        {/* Drop box / text box */}
        <div
          className="box"
          style={{ left: 17, top: 255, width: 368, height: 220, background: dragOver ? '#f4f4f4' : '#fff' }}
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
              <span
                className="t"
                style={{ left: 45, top: 83, width: 272, fontFamily: 'var(--inter)', fontWeight: 500, fontSize: 17, color: 'var(--drop-title)', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {file ? file.name : 'Drop a File or Choose one '}
              </span>
              <span
                className="t"
                style={{ left: 45, top: 106, width: 272, fontFamily: 'var(--inter)', fontWeight: 500, fontSize: 14, color: 'var(--drop-sub)' }}
              >
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
                placeholder="Type or paste your text"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  border: 0,
                  outline: 'none',
                  resize: 'none',
                  padding: '20px 22px',
                  background: 'transparent',
                  fontFamily: 'var(--inter)',
                  fontWeight: 500,
                  fontSize: 17,
                  lineHeight: 1.45,
                  color: 'var(--drop-title)',
                }}
              />
            </>
          )}
        </div>

        {/* Duration */}
        <T as="label" cx={77} top={493} size={17} style={{ pointerEvents: 'auto' }}>
          <span>Duration ?</span>
        </T>
        <div className="abs" style={{ left: 17, top: 522, width: 368, height: 41 }}>
          <img src={selectFrame} alt="" width={368} height={41} style={{ display: 'block', pointerEvents: 'none' }} />
          <select
            aria-label="Duration"
            value={ttl}
            disabled={!!busy}
            onChange={(e) => setTtl(Number(e.target.value))}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              appearance: 'none',
              WebkitAppearance: 'none',
              border: 0,
              borderRadius: 19,
              background: 'transparent',
              outline: 'none',
              paddingLeft: 21.88,
              paddingRight: 40,
              paddingTop: 8,
              paddingBottom: 0,
              fontFamily: 'var(--alkalami)',
              fontSize: 17,
              lineHeight: 'normal',
              color: '#000',
              cursor: 'pointer',
            }}
          >
            {EXPIRY_OPTIONS.filter((o) => !isLarge || o.seconds <= LARGE_FILE_MAX_TTL_SECONDS).map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Link type */}
        <T cx={79} top={581} size={17}>
          Link Type ?
        </T>
        <div role="radiogroup" aria-label="Link Type">
          {(
            [
              { value: 'public', label: 'Public', row: 611, radio: 627, textTop: 621, cx: 89 },
              { value: 'private', label: 'Private', row: 666, radio: 681, textTop: 674, cx: 92 },
            ] as const
          ).map((o) => {
            const selected = visibility === o.value;
            return (
              <div key={o.value}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!!busy}
                  onClick={() => setVisibility(o.value)}
                  className="abs"
                  style={{
                    left: 17,
                    top: o.row,
                    width: 368,
                    height: o.value === 'private' && selected ? 100 : 41,
                    transition: 'height 300ms var(--ease-spring), border-color 200ms',
                    background: '#fff',
                    border: `3px solid ${selected ? '#000' : 'var(--grey-border)'}`,
                    borderRadius: 30,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  <span className="visually-hidden">{o.label}</span>
                </button>
                <img className="abs" src={selected ? radioOn : radioOff} alt="" width={12} height={12} style={{ left: 37, top: o.radio, pointerEvents: 'none' }} />
                <T cx={o.cx} top={o.textTop} size={17}>
                  {o.label}
                </T>
                {o.value === 'private' && selected && (
                  <div className="pin-field" style={{ left: 34, top: o.row + 47, width: 125, height: 38 }}>
                    <label htmlFor="link-pin" className="visually-hidden">
                      {PIN_LENGTH}-digit PIN for the receiver
                    </label>
                    <input
                      id="link-pin"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={PIN_LENGTH}
                      placeholder={`${PIN_LENGTH}-digit PIN`}
                      value={pin}
                      disabled={!!busy}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Pill
          type="submit"
          variant="black"
          rect={{ left: 126, top: 733 + pinShift, width: 148, height: 41 }}
          label={busy?.label ?? 'Create Link'}
          disabled={!!busy && busy.progress === undefined}
          progress={busy?.progress}
          onClick={busy?.progress !== undefined && busy.progress < 1 ? () => abortRef.current?.abort() : undefined}
          ariaLabel={busy?.progress !== undefined && busy.progress < 1 ? `${busy.label}. Activate to cancel.` : undefined}
        />

        {TURNSTILE_SITE_KEY && (
          <div className="abs" style={{ left: 36, top: 790 + pinShift }}>
            <Turnstile onToken={setTurnstileToken} resetKey={turnstileReset} />
          </div>
        )}

        {status && (
          <p className={`status ${status.kind === 'error' ? 'is-error' : ''}`} role="alert" style={{ top: 784 + pinShift }}>
            <span className="bg">
              {status.message}
            </span>
          </p>
        )}
      </form>
    </Screen>
  );
}

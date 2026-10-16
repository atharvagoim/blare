import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { eyeIcon, logo, monkey } from '../design/assets';
import { Img, Monkey, Pill } from '../design/primitives';
import { Screen } from '../design/Screen';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * A Figma input frame: 368 × 42, 3px black border, radius 30. `textLeft` is where the
 * placeholder starts, measured from the frame's outer edge, so typed text lines up with it.
 */
function Field({
  id,
  top,
  textLeft,
  placeholder,
  value,
  onChange,
  type = 'text',
  autoComplete,
  password,
  onFocus,
  onBlur,
  inputMode,
}: {
  id: string;
  top: number;
  textLeft: number;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  password?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  inputMode?: 'email' | 'text';
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field" style={{ left: 17, top, width: 368, height: 42 }}>
      <label htmlFor={id} className="visually-hidden">
        {placeholder}
      </label>
      <input
        id={id}
        type={password ? (shown ? 'text' : 'password') : type}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        // Figma places the text 3px below the field's vertical centre.
        style={{ paddingLeft: textLeft - 3, paddingRight: password ? 40 : 16, paddingTop: 6, paddingBottom: 0 }}
      />
      {password && (
        <button
          type="button"
          className={`eye-btn${shown ? ' is-shown' : ''}`}
          style={{ left: 334, top: 10 }}
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
        >
          <img src={eyeIcon} alt="" />
        </button>
      )}
    </div>
  );
}

function useAfterAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const next = (location.state as { next?: string } | null)?.next;
  return () => navigate(next && next.startsWith('/') ? next : '/', { replace: true });
}

// Figma "iPhone 17 - 6"
export function LoginPage() {
  const { setUser } = useAuth();
  const done = useAfterAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Login · share';
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError('Enter your email ID and password.');
    setBusy(true);
    try {
      const { user } = await api.login(email.trim(), password);
      setUser(user);
      done();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'Could not log in. Try again.');
    }
  }

  return (
    <Screen decor={['cactus']} label="Login">
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 90, top: 45, width: 222, height: 75 }} alt="Blare" />
        <Monkey src={monkey} rect={{ left: 228, top: 150, width: 115, height: 134 }} />
        <Field id="login-email" top={275} textLeft={31.27} placeholder="Email ID" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} />
        <Field id="login-password" top={335} textLeft={29.32} placeholder="Password" password autoComplete="current-password" value={password} onChange={setPassword} />
        <Pill type="submit" variant="black" rect={{ left: 127, top: 410, width: 148, height: 41 }} label={busy ? 'Logging in…' : 'Login'} disabled={busy} />
        <p className="switch-note" style={{ top: 472 }}>
          Don&rsquo;t have an account? <Link to="/signup">Create a new one</Link>
        </p>
        {error && (
          <p className="status is-error" role="alert" style={{ top: 504 }}>
            <span className="bg">{error}</span>
          </p>
        )}
      </form>
    </Screen>
  );
}

// Figma "iPhone 17 - 7"
export function SignupPage() {
  const { setUser } = useAuth();
  const done = useAfterAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Sign up · share';
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email ID.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const { user } = await api.signup({ name: name.trim(), email: email.trim(), password, confirmPassword: confirm });
      setUser(user);
      done();
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : 'Could not create your account. Try again.');
    }
  }

  return (
    <Screen decor={['cactus']} label="Sign up">
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 90, top: 45, width: 222, height: 75 }} alt="Blare" />
        <Monkey src={monkey} rect={{ left: 228, top: 150, width: 115, height: 134 }} />
        <Field id="signup-name" top={275} textLeft={26.91} placeholder="Full name" autoComplete="name" value={name} onChange={setName} />
        <Field id="signup-email" top={333} textLeft={27.27} placeholder="Email ID" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} />
        <Field id="signup-password" top={391} textLeft={29.32} placeholder="Password" password autoComplete="new-password" value={password} onChange={setPassword} />
        <Field id="signup-confirm" top={449} textLeft={28.13} placeholder="ConfirmPassword" password autoComplete="new-password" value={confirm} onChange={setConfirm} />
        <Pill type="submit" variant="black" rect={{ left: 127, top: 520, width: 148, height: 41 }} label={busy ? 'Creating…' : 'Sign up'} disabled={busy} />
        <p className="switch-note" style={{ top: 574 }}>
          Already have an account? <Link to="/login">Login</Link>
        </p>
        {error && (
          <p className="status is-error" role="alert" style={{ top: 604 }}>
            <span className="bg">{error}</span>
          </p>
        )}
      </form>
    </Screen>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { eyeIcon, logo } from '../design/assets';
import { Img, Pill } from '../design/primitives';
import { Screen } from '../design/Screen';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';

/** A glass input: 368 × 42. Every field starts its text at the same x so the placeholders line up. */
function Field({
  id,
  top,
  placeholder,
  value,
  onChange,
  type = 'text',
  autoComplete,
  password,
  onFocus,
  onBlur,
  inputMode,
  invalid,
  autoFocus,
  disabled,
}: {
  id: string;
  top: number;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  password?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  inputMode?: 'email' | 'text';
  invalid?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field" data-invalid={invalid || undefined} style={{ left: 17, top, width: 368, height: 42 }}>
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
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        autoCapitalize={type === 'email' || password ? 'none' : undefined}
        spellCheck={type === 'email' || password ? false : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        // Figma places the text 3px below the field's vertical centre.
        style={{ paddingLeft: 24, paddingRight: password ? 44 : 20, paddingTop: 0, paddingBottom: 0 }}
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
  return () => navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
}

/** Someone who is already logged in has no business on the login / sign-up screens. */
function useRedirectIfLoggedIn(done: () => void) {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!loading && user) done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);
}

type FieldError = { field: 'email' | 'password' | 'name' | 'confirm' | 'all'; message: string } | null;

// Figma "iPhone 17 - 6"
export function LoginPage() {
  const { setUser } = useAuth();
  const done = useAfterAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FieldError>(null);

  useRedirectIfLoggedIn(done);

  useEffect(() => {
    document.title = 'Login · Blare';
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError({ field: 'email', message: 'Enter your email ID.' });
    if (!password) return setError({ field: 'password', message: 'Enter your password.' });
    setBusy(true);
    try {
      const { user } = await api.login(email.trim(), password);
      setUser(user);
      done();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === 'invalid_login') {
        setPassword('');
        return setError({ field: 'all', message: err.message });
      }
      setError({ field: 'all', message: err instanceof ApiError ? err.message : 'Could not log in. Check your connection and try again.' });
    }
  }

  return (
    <Screen label="Login">
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 66, top: 60, width: 270, height: 100 }} alt="Blare" />
        <Field id="login-email" top={235} placeholder="Email ID" type="email" inputMode="email" autoComplete="email" autoFocus disabled={busy} invalid={error?.field === 'email' || error?.field === 'all'} value={email} onChange={setEmail} />
        <Field id="login-password" top={295} placeholder="Password" password autoComplete="current-password" disabled={busy} invalid={error?.field === 'password' || error?.field === 'all'} value={password} onChange={setPassword} />
        <Pill type="submit" variant="black" rect={{ left: 127, top: 370, width: 148, height: 41 }} label={busy ? 'Logging in…' : 'Login'} disabled={busy} />
        <p className="switch-note" style={{ top: 432 }}>
          Don&rsquo;t have an account? <Link to="/signup">Create a new one</Link>
        </p>
        {error && (
          <p className="status is-error" role="alert" style={{ top: 464 }}>
            <span className="bg">{error.message}</span>
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
  const [error, setError] = useState<FieldError>(null);

  useRedirectIfLoggedIn(done);

  useEffect(() => {
    document.title = 'Sign up · Blare';
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError({ field: 'name', message: 'Enter your full name.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError({ field: 'email', message: 'Enter a valid email ID.' });
    if (password.length < 8) return setError({ field: 'password', message: 'Password must be at least 8 characters.' });
    if (password !== confirm) return setError({ field: 'confirm', message: 'Passwords do not match.' });
    setBusy(true);
    try {
      const { user } = await api.signup({ name: name.trim(), email: email.trim(), password, confirmPassword: confirm });
      setUser(user);
      done();
    } catch (err) {
      setBusy(false);
      const field = err instanceof ApiError && err.code === 'email_taken' ? 'email' : 'all';
      setError({ field, message: err instanceof ApiError ? err.message : 'Could not create your account. Check your connection and try again.' });
    }
  }

  return (
    <Screen label="Sign up">
      <form onSubmit={submit} noValidate>
        <Img className="logo" src={logo} rect={{ left: 66, top: 60, width: 270, height: 100 }} alt="Blare" />
        <Field id="signup-name" top={235} placeholder="Full name" autoComplete="name" autoFocus disabled={busy} invalid={error?.field === 'name'} value={name} onChange={setName} />
        <Field id="signup-email" top={293} placeholder="Email ID" type="email" inputMode="email" autoComplete="email" disabled={busy} invalid={error?.field === 'email'} value={email} onChange={setEmail} />
        <Field id="signup-password" top={351} placeholder="Password" password autoComplete="new-password" disabled={busy} invalid={error?.field === 'password'} value={password} onChange={setPassword} />
        <Field id="signup-confirm" top={409} placeholder="Confirm password" password autoComplete="new-password" disabled={busy} invalid={error?.field === 'confirm'} value={confirm} onChange={setConfirm} />
        <Pill type="submit" variant="black" rect={{ left: 127, top: 480, width: 148, height: 41 }} label={busy ? 'Creating…' : 'Sign up'} disabled={busy} />
        <p className="switch-note" style={{ top: 534 }}>
          Already have an account? <Link to="/login">Login</Link>
        </p>
        {error && (
          <p className="status is-error" role="alert" style={{ top: 564 }}>
            <span className="bg">{error.message}</span>
          </p>
        )}
      </form>
    </Screen>
  );
}

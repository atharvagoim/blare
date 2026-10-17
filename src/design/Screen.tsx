import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { menuIcon } from './assets';

/** `height` is the canvas height in px (default 874); pages with less content pass less so there is no dead space above the footer. */
export function Screen({ children, label, topRight, height = 874 }: { children: ReactNode; label: string; topRight?: ReactNode; height?: number }) {
  return (
    <>
    <div className="screen" style={{ ['--h' as string]: `${height}px` }}>
      <Menu />
      {topRight && <div className="top-action">{topRight}</div>}
      <main className="canvas-wrap" aria-label={label}>
        <div className="canvas">{children}</div>
      </main>
    </div>
    <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-logo">Blare</span>
          <span className="footer-tag">Share files &amp; text with a link that disappears on your schedule.</span>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          <Link to="/">Create link</Link>
          <Link to="/login">Login</Link>
          <Link to="/signup">Sign up</Link>
        </nav>
      </div>
      <p className="footer-copy">&copy; {new Date().getFullYear()} Blare. All rights reserved.</p>
    </footer>
  );
}

function Menu() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={button}
        type="button"
        className="menu-btn"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <img src={menuIcon} alt="" />
      </button>
      {open && (
        <div id="site-menu" ref={panel} className="menu-panel">
          <Link to="/" onClick={close}>
            Create new
          </Link>
          <Link to="/live" onClick={close}>
            Live links
          </Link>
          {user ? (
            <>
              <span className="menu-user">{user.name}</span>
              <button
                type="button"
                onClick={async () => {
                  close();
                  await logout();
                  navigate('/');
                }}
              >
                Log out
              </button>
            </>
          ) : (
            <Link to="/login" onClick={close}>
              Login
            </Link>
          )}
        </div>
      )}
    </>
  );
}

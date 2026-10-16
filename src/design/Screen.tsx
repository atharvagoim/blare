import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { cactus, menuIcon, sunflower } from './assets';

export type Decor = 'cactus' | 'cactus-low' | 'sunflower' | 'sunflower-expired';

export function Screen({ decor, children, label }: { decor: Decor[]; children: ReactNode; label: string }) {
  return (
    <>
    <div className="screen">
      <Menu />
      <main className="canvas-wrap" aria-label={label}>
        <div className="canvas">{children}</div>
      </main>
      {decor.includes('cactus') && <img className="decor decor-cactus" src={cactus} alt="" />}
      {decor.includes('cactus-low') && <img className="decor decor-cactus is-low" src={cactus} alt="" />}
      {decor.includes('sunflower') && <img className="decor decor-sunflower" src={sunflower} alt="" />}
      {decor.includes('sunflower-expired') && <img className="decor decor-sunflower is-expired" src={sunflower} alt="" />}
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
            Create Link
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
            <>
              <Link to="/login" onClick={close}>
                Login
              </Link>
              <Link to="/signup" onClick={close}>
                Sign up
              </Link>
            </>
          )}
        </div>
      )}
    </>
  );
}

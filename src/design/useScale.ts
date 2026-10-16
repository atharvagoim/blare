import { useLayoutEffect } from 'react';

/** Sets --s so the 402px-wide Figma canvas fits phones narrower than 402px; 1 everywhere else. */
export function useScale() {
  useLayoutEffect(() => {
    const apply = () => {
      const width = document.documentElement.clientWidth || window.innerWidth;
      document.documentElement.style.setProperty('--s', String(Math.min(1, width / 402)));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
}

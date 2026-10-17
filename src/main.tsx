import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { pruneManageTokens } from './lib/manage';
import './theme.css';

pruneManageTokens();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

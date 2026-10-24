import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { apiReady } from './lib/api-client';

import './app.css';

// In dev mock mode the fixture adapter is loaded first; otherwise this resolves immediately.
void apiReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

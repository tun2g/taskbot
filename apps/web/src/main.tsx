import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import { bootTelegramViewport } from './lib/telegram';

import './app.css';

// telegram-web-app.js is a `defer` script placed before this module entry in index.html, so
// window.Telegram.WebApp already exists here. Fullscreen is requested before React mounts and
// the #boot splash (inside #root) stays up until it settles (≤ ~300ms), hiding the layout jump.
function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

let boot: Promise<void>;
try {
  boot = bootTelegramViewport();
} catch {
  boot = Promise.resolve();
}
void boot.catch(() => undefined).then(mount);

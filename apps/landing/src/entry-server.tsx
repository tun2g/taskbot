import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';

import { App } from './app';

/** Renders the page to HTML at build time so crawlers and link previews get the content without running JS. */
export function render() {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

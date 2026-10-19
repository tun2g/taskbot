import { getTelegramWebApp, isInTelegram } from './telegram';

/**
 * One owner for Telegram's native BackButton. Telegram calls *every* registered onClick
 * handler, so pages and overlays can't each register their own: the page sets its "back"
 * handler, and overlays (select sheets) push an interceptor that runs instead while open.
 */
type Handler = () => void;

const interceptors: Handler[] = [];
let pageBack: Handler | null = null;
let registered = false;

function dispatch() {
  const top = interceptors[interceptors.length - 1];
  if (top) top();
  else pageBack?.();
}

function sync() {
  const webApp = getTelegramWebApp();
  if (!webApp || !isInTelegram()) return;
  if (!registered) {
    webApp.BackButton.onClick(dispatch);
    registered = true;
  }
  if (interceptors.length > 0 || pageBack) webApp.BackButton.show();
  else webApp.BackButton.hide();
}

/** The page-level back action (Layout's `onBack`). Returns a cleanup. */
export function setPageBack(handler: Handler): () => void {
  pageBack = handler;
  sync();
  return () => {
    if (pageBack === handler) pageBack = null;
    sync();
  };
}

/** While registered, the BackButton calls `handler` instead of the page's back. */
export function pushBackInterceptor(handler: Handler): () => void {
  interceptors.push(handler);
  sync();
  return () => {
    const i = interceptors.lastIndexOf(handler);
    if (i >= 0) interceptors.splice(i, 1);
    sync();
  };
}

import type { TelegramLoginPayload } from '@tbot/shared';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramLoginPayload) => void;
  }
}

interface TelegramLoginButtonProps {
  botUsername: string;
  onAuth: (payload: TelegramLoginPayload) => void;
}

/** Renders the official Telegram Login Widget (https://core.telegram.org/widgets/login). */
export function TelegramLoginButton({ botUsername, onAuth }: TelegramLoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onAuthRef = useRef(onAuth);
  onAuthRef.current = onAuth;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    window.onTelegramAuth = (user) => onAuthRef.current(user);

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      delete window.onTelegramAuth;
    };
  }, [botUsername]);

  return <div ref={containerRef} className="flex min-h-12 justify-center" />;
}

import { config } from 'src/config/configuration';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** Options of the session cookie (the same for setting and clearing it). */
export function cookieOptions() {
  return {
    httpOnly: true,
    secure: !config.devMode,
    sameSite: 'strict' as const,
    path: '/api',
  };
}

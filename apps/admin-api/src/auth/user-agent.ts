import type { Request } from 'express';

/**
 * "Safari on iPhone", "Chrome on Windows" — enough to recognise your own devices in the sign-in list.
 * Deliberately small: no lookup service and no version numbers.
 */
export function describeUserAgent(ua: string | undefined | null): string {
  const s = (ua ?? '').slice(0, 512);
  if (!s) return 'Unknown browser';

  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /SamsungBrowser\//.test(s)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(s)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : /curl|wget|python|node|axios|undici/i.test(s)
                ? 'A script'
                : 'Unknown browser';

  const os = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? 'Android'
        : /Windows/.test(s)
          ? 'Windows'
          : /CrOS/.test(s)
            ? 'ChromeOS'
            : /Mac OS X|Macintosh/.test(s)
              ? 'Mac'
              : /Linux/.test(s)
                ? 'Linux'
                : null;

  return os ? `${browser} on ${os}` : browser;
}

/** The client address without the IPv4-mapped IPv6 prefix ("::ffff:1.2.3.4" → "1.2.3.4"). */
export function clientIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

/** Browser + address of a request, for the session record and the audit log. */
export function deviceOf(req: Request) {
  const userAgent = String(req.headers['user-agent'] ?? '');
  return { userAgent, browser: describeUserAgent(userAgent), ip: clientIp(req.ip) };
}

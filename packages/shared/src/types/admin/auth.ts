/** Admin sign-in: one-time login links and browser sessions. */

/** POST /auth/request-link → sends a one-time login link to the bot owner's Telegram DM. */
export interface AdminLoginLinkResponse {
  /** Where the link went, masked for display ("@tun2g" / "your Telegram account"). */
  sentTo: string;
  /** Seconds until the link expires. */
  expiresInSeconds: number;
  /** Lets this browser ask whether the link was used (GET /auth/link-status) — never logs it in. */
  requestId?: string;
}

/** POST /auth/exchange { code } → sets the session cookie. */
export interface AdminSession {
  owner: { telegramUserId: number; name: string; username: string | null };
  expiresAt: string;
}

/** GET /auth/link-status?requestId= — whether the login link sent for this request was used (no session is given). */
export interface AdminLoginLinkStatus {
  status: 'unused' | 'used' | 'expired';
}

/** GET /auth/sessions — browsers signed in to the admin app, newest first. */
export interface AdminSessionRow {
  id: string;
  /** "Safari on iPhone" (from the user agent at sign-in). */
  browser: string;
  /** Approximate: the address the sign-in came from. */
  ip: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  /** The browser making this request. */
  current: boolean;
}

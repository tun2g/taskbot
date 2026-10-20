export interface ApiResponse<T> {
  data: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    /** True when later pages exist (page * limit < total, give or take concurrent changes). */
    hasMore?: boolean;
  };
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Payload from the Telegram Login Widget (https://core.telegram.org/widgets/login),
 * posted as-is to POST /auth/telegram-login.
 */
export interface TelegramLoginPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/** Response of POST /auth/telegram-login. Send as `Authorization: Bearer <token>`. */
export interface AuthLoginResponse {
  token: string;
  expiresAt: string;
  user: import('./user.js').IUser;
}

/**
 * A personal access token for the MCP server (Claude Code, Cursor, …). The secret itself is only
 * returned once, by POST /api/me/tokens.
 */
export interface IApiToken {
  _id: string;
  name: string;
  /** First 8 characters of the secret (e.g. "tbot_a1B"), to tell tokens apart. */
  prefix: string;
  /** ISO date. */
  createdAt: string;
  /** ISO date, or null when never used. */
  lastUsedAt: string | null;
  /** The one group this token works for, or null = every group the user is a member of. */
  group: ApiTokenGroup | null;
}

export interface ApiTokenGroup {
  _id: string;
  title: string;
}

/** POST /api/me/tokens */
export interface CreateApiTokenInput {
  name: string;
  /** Limit the token to this group (the caller must be a member); null / omitted = all my groups. */
  groupId?: string | null;
}

/** Response data of POST /api/me/tokens — `secret` is shown once and never again. */
export interface CreateApiTokenResponse {
  token: IApiToken;
  secret: string;
}

/** Response data of DELETE /api/me/tokens/:id */
export interface RevokeApiTokenResponse {
  revoked: true;
}

/** Response data of GET /api/mcp-info */
export interface McpInfoResponse {
  /** Public MCP endpoint, e.g. https://taskbot.example.com/mcp */
  url: string;
}

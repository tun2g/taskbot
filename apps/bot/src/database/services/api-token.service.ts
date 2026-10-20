import type { IApiToken as ApiTokenDto, ApiTokenGroup } from '@tbot/shared';
import { createHash, randomBytes } from 'crypto';
import mongoose from 'mongoose';
import { ApiToken, IApiToken } from 'src/database/models/api-token.model';
// Registers the Group model for populate('groupId').
import 'src/database/models/group.model';
import { IUser, User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';

export const API_TOKEN_PREFIX = 'tbot_';
/** Random part of a secret: 40 base62 characters ≈ 238 bits. */
const SECRET_RANDOM_LENGTH = 40;
const DISPLAY_PREFIX_LENGTH = 8;
export const MAX_ACTIVE_TOKENS = 10;
/** lastUsedAt is written at most this often per token. */
const TOUCH_INTERVAL_MS = 60 * 1000;
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_FORMAT = /^tbot_[A-Za-z0-9]{32,}$/;

export const TOO_MANY_TOKENS_MESSAGE = `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use, then try again.`;

export class TooManyTokensError extends Error {
  constructor() {
    super(TOO_MANY_TOKENS_MESSAGE);
    this.name = 'TooManyTokensError';
  }
}

export type TokenAuthResult =
  | { ok: true; token: IApiToken; user: IUser }
  | { ok: false; reason: 'malformed' | 'unknown' | 'revoked' | 'expired' };

/** `tbot_` + 40 random base62 characters (rejection sampling, so every character is equally likely). */
export function generateTokenSecret(): string {
  let out = '';
  while (out.length < SECRET_RANDOM_LENGTH) {
    for (const byte of randomBytes(64)) {
      if (byte < 248 && out.length < SECRET_RANDOM_LENGTH) out += BASE62[byte % 62];
    }
  }
  return `${API_TOKEN_PREFIX}${out}`;
}

export function hashTokenSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** True for strings shaped like one of our personal access tokens (never a web session token). */
export function isApiTokenSecret(value: string): boolean {
  return value.startsWith(API_TOKEN_PREFIX);
}

const iso = (date: Date | null | undefined) => (date ? new Date(date).toISOString() : null);

/** The populated scope group as `{ _id, title }`; null for all-groups tokens (or a group that no longer exists). */
function scopeOf(ref: unknown): ApiTokenGroup | null {
  if (!ref || typeof ref !== 'object' || !('groupName' in (ref as object))) return null;
  const group = ref as { _id: unknown; groupName: string };
  return { _id: String(group._id), title: group.groupName };
}

export function toApiTokenDto(token: IApiToken): ApiTokenDto {
  return {
    _id: String(token._id),
    name: token.name,
    prefix: token.prefix,
    createdAt: iso(token.createdAt) ?? new Date(0).toISOString(),
    lastUsedAt: iso(token.lastUsedAt),
    group: scopeOf(token.groupId),
  };
}

function activeFilter(userId: mongoose.Types.ObjectId | string, now = new Date()) {
  return {
    userId,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  };
}

export class ApiTokenService {
  /** The user's usable tokens, newest first (scope group populated). */
  async listActive(userId: mongoose.Types.ObjectId | string): Promise<IApiToken[]> {
    return ApiToken.find(activeFilter(userId)).sort({ createdAt: -1 }).populate('groupId');
  }

  /**
   * Creates a token and returns it with its secret (the only time the secret exists in clear). `groupId` scopes it
   * to one group — membership is the caller's job to check.
   */
  async create(
    userId: mongoose.Types.ObjectId | string,
    name: string,
    groupId: mongoose.Types.ObjectId | string | null = null,
  ): Promise<{ token: IApiToken; secret: string }> {
    const active = await ApiToken.countDocuments(activeFilter(userId));
    if (active >= MAX_ACTIVE_TOKENS) throw new TooManyTokensError();

    const secret = generateTokenSecret();
    const token = await ApiToken.create({
      userId,
      name: name.trim().slice(0, 80) || 'Token',
      groupId: groupId ? new mongoose.Types.ObjectId(String(groupId)) : null,
      tokenHash: hashTokenSecret(secret),
      prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    });
    logger.info(`API token ${token._id} created for user ${userId}${groupId ? ` (group ${groupId})` : ''}`);
    if (typeof token.populate === 'function' && groupId) await token.populate('groupId');
    return { token, secret };
  }

  /** Revokes one of the user's tokens. False when it doesn't exist, isn't theirs or was already revoked. */
  async revoke(userId: mongoose.Types.ObjectId | string, tokenId: string): Promise<boolean> {
    if (!mongoose.Types.ObjectId.isValid(tokenId)) return false;
    const result = await ApiToken.updateOne(
      { _id: tokenId, userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    return (result.modifiedCount ?? 0) > 0;
  }

  /** Resolves a `tbot_…` secret to its token and user. */
  async authenticate(secret: string, now = new Date()): Promise<TokenAuthResult> {
    if (!TOKEN_FORMAT.test(secret)) return { ok: false, reason: 'malformed' };
    const token = await ApiToken.findOne({ tokenHash: hashTokenSecret(secret) });
    if (!token) return { ok: false, reason: 'unknown' };
    if (token.revokedAt) return { ok: false, reason: 'revoked' };
    if (token.expiresAt && new Date(token.expiresAt).getTime() <= now.getTime())
      return { ok: false, reason: 'expired' };
    const user = await User.findById(token.userId);
    if (!user) return { ok: false, reason: 'unknown' };
    return { ok: true, token, user };
  }

  /** Records use — at most one write per token per minute. Never throws. */
  async touch(token: IApiToken, now = new Date()): Promise<void> {
    const last = token.lastUsedAt ? new Date(token.lastUsedAt).getTime() : 0;
    if (now.getTime() - last < TOUCH_INTERVAL_MS) return;
    try {
      await ApiToken.updateOne({ _id: token._id }, { $set: { lastUsedAt: now } });
      token.lastUsedAt = now;
    } catch (error) {
      logger.warn(`Could not update lastUsedAt of API token ${token._id}: ${error}`);
    }
  }
}

export const apiTokenService = new ApiTokenService();

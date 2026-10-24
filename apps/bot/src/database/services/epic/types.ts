import { EPIC_AUTO_COLORS, EpicColor, EpicStatus } from '@tbot/shared';
import mongoose from 'mongoose';

export interface EpicProgress {
  /** Tasks in the epic, cancelled ones excluded. */
  total: number;
  /** Tasks in the "done" category (cancelled excluded). */
  done: number;
  /** Tasks in the "in progress" category. */
  inProgress: number;
  /** Cancelled tasks still in the epic (not part of `total`). */
  cancelled: number;
}

export type EpicWithProgress = Record<string, unknown> & { _id: mongoose.Types.ObjectId; progress: EpicProgress };

export interface CreateEpicData {
  groupId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  title: string;
  description?: string | null;
  color?: EpicColor;
  /** Undo of a delete recreates a done epic as done. */
  status?: EpicStatus;
}

export interface UpdateEpicData {
  title?: string;
  description?: string | null;
  color?: EpicColor;
  status?: EpicStatus;
}

/** Thrown when another epic in the same group already has this title (case-insensitive) → 409. */
export class EpicTitleTakenError extends Error {
  constructor(public readonly title: string) {
    super(`An epic called "${title}" already exists in this group. Pick another name.`);
    this.name = 'EpicTitleTakenError';
  }
}

export function emptyProgress(): EpicProgress {
  return { total: 0, done: 0, inProgress: 0, cancelled: 0 };
}

/** Collapse spaces so "Login  page" and "Login page" are the same title. */
export function normalizeEpicTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Least-used color in the group; ties go to the earliest color in palette order. Red is never auto-picked. */
export function pickLeastUsedColor(usage: Partial<Record<string, number>>): EpicColor {
  let best = EPIC_AUTO_COLORS[0];
  let bestCount = Infinity;
  for (const color of EPIC_AUTO_COLORS) {
    const count = usage[color] ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

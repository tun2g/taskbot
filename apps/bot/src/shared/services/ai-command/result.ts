import type { AiBoardFilters } from '@tbot/shared';
import type { SubtaskProgress } from 'src/database/services/subtask.service';
import type { ReadyItem } from 'src/shared/services/ai-command/subtask-items';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import type { TaskChange } from 'src/shared/services/task-sync.service';

/**
 * Channel-agnostic outcome of one AI request (Telegram /ai or the web "Ask AI" chat).
 * All strings here are PLAIN text; each renderer escapes/formats them for its channel.
 */

/** Minimal Telegram API surface used to refresh task cards. */
export interface CardEditor {
  editMessageText(
    chatId: number,
    messageId: number,
    inlineMessageId: undefined,
    text: string,
    extra: Record<string, unknown>,
  ): Promise<unknown>;
}

/** Why a change could not be aimed at exactly one task. Nothing was changed. */
export type TargetMiss =
  | { reason: 'which' }
  | { reason: 'missing'; number: number }
  | { reason: 'no_match'; search: string }
  | { reason: 'ambiguous'; candidates: ITask[] }
  /** "it" after an answer that showed several tasks (web chat). */
  | { reason: 'previous_ambiguous'; numbers: number[] };

/** An epic as the AI replies show it: colored dot + title (plain). */
export interface EpicRef {
  _id: string;
  title: string;
  color: string;
}

/** "Put #5 in epic Login" when the group has no epic "Login" (nothing was created). */
export interface EpicMiss {
  /** The title as the user wrote it. */
  title: string;
  /** Open epics of the group (closest matches first, at most MAX_EPIC_SUGGESTIONS). */
  suggestions: EpicRef[];
  /** Open epics not listed. */
  more: number;
}

export interface UpdateOutcome {
  /** The task as it was before. */
  original: ITask;
  /** The task as it is now (equals `original` when nothing changed). */
  task: ITask;
  /** Plain change lines, e.g. "👤 @an → @ttt", "👀 In review". */
  changes: string[];
  /** Plain notes, e.g. "ℹ️ Already ✅ Done.", "⚠️ Couldn't find @x …". */
  notes: string[];
  /** Field-level changes (labels) for "(via app)" group posts. */
  fieldChanges: TaskChange[];
  /** True when the update stopped half-way (DB error). */
  failed: boolean;
  /** The requested epic doesn't exist (the other changes were still applied). */
  epicMiss?: EpicMiss;
}

/** "/ai tạo epic Login". */
export interface EpicCreateOutcome {
  /** The new epic, or the existing one with that title when `duplicate`. */
  epic: EpicRef;
  duplicate: boolean;
}

/** One row of the epics overview: "🔵 Login — 3/7 done". */
export interface EpicOverviewRow extends EpicRef {
  status: string;
  total: number;
  done: number;
}

export type QueryOutcome =
  | {
      kind: 'list';
      /** The planner's query kind (mine, overdue, …). */
      queryKind: string;
      /** True when the list is the requester's own tasks. */
      mine: boolean;
      /** "Your open tasks", "Overdue tasks for @an matching “login”". */
      title: string;
      icon: string;
      /** Every match, sorted (due date, then newest). */
      tasks: ITask[];
      /** False when the query filtered by one status (the status is implied). */
      showStatus: boolean;
      /** False when the query was about one person. */
      showAssignee: boolean;
      /** Text for an empty list. */
      emptyText: string;
      /** The epic the list is filtered by. */
      epic?: EpicRef;
      /** The same query as board filters (web: "View all N on board" opens exactly these tasks). */
      boardFilters: AiBoardFilters;
    }
  | { kind: 'unknown_person'; person: string }
  | { kind: 'unknown_epic'; miss: EpicMiss }
  /** Every epic with its progress, open ones first (renderers show at most MAX_EPIC_OVERVIEW). */
  | { kind: 'epics'; epics: EpicOverviewRow[] };

/** A read-only explanation of one task ("giải thích #5"). */
export interface ExplainOutcome {
  /** The task as it is now (after any change made by the same request). */
  task: ITask;
  /** Plain text written by the AI from the full task; null when the AI was unavailable. */
  text: string | null;
  /** Display name of the assignee (null = unassigned), for the state line. */
  assignee: string | null;
  /** The task is the replied card (web: the open task) — already on screen, so no state lines / Open button. */
  fromReply?: boolean;
  /** Its subtasks' progress (absent / null = none). */
  subtasks?: SubtaskProgress | null;
}

/** "/ai chia #42 thành subtask …" — subtasks added to one task (or why none were). */
export interface SubtasksOutcome {
  parent: ITask;
  /** In creation order, with the resolved assignee (null = unassigned). */
  created: { task: ITask; assignee: IUser | null }[];
  /** True when the AI proposed the items (the user only asked for a breakdown). */
  proposed: boolean;
  /** Plain notes: unknown people, items cut by the limit, items that could not be saved. */
  warnings: string[];
  /** Shared by the new subtasks (undo); null when nothing was created. */
  batchId: string | null;
  /** Telegram: key of the ↩️ Undo button's stored batch data. */
  undoKey?: string;
  /** A rule refused the whole request (e.g. #42 is itself a subtask) — plain sentence; nothing was created. */
  refusal?: string;
  /** AI-proposed items waiting for the requester's ✅ Add all (nothing created yet); `id` = the stored proposal. */
  preview?: { id: string; items: ReadyItem[] };
}

export type AiSection =
  | { type: 'update'; update: UpdateOutcome }
  | { type: 'explain'; explain: ExplainOutcome }
  | { type: 'epic_created'; epic: EpicCreateOutcome }
  | { type: 'subtasks'; subtasks: SubtasksOutcome }
  /** Short plain notes, e.g. "❌ No task #55." next to the explanations that did work. */
  | { type: 'note'; lines: string[] }
  | { type: 'query'; query: QueryOutcome }
  | { type: 'answer'; text: string };

export type AiResult =
  | { kind: 'clarify'; question: string }
  | { kind: 'which_task'; miss: TargetMiss }
  | { kind: 'refused'; reason: 'delete' | 'bulk' | 'mixed_create' }
  /** Hand-off to the task creation pipeline. */
  | { kind: 'create'; useReply: boolean }
  | { kind: 'sections'; sections: AiSection[] };

export const changedUpdates = (sections: AiSection[]): UpdateOutcome[] =>
  sections.flatMap((s) => (s.type === 'update' && s.update.changes.length ? [s.update] : []));

import { ITask } from 'src/database/models/task.model';
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
    }
  | { kind: 'unknown_person'; person: string };

export type AiSection =
  | { type: 'update'; update: UpdateOutcome }
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

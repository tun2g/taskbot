import { BufferedMessage } from 'src/shared/services/message-buffer.service';

export const MAX_EXTRACTED_TASKS = 20;
export const TITLE_MAX = 200; // DB limit; the prompt asks for ≤ 120
export const DESCRIPTION_MAX = 2000;
export const FALLBACK_DESCRIPTION_MAX = 4000;

/** Most epics shown to the extractor, and how much of each description. */
export const EXTRACTION_EPICS_MAX = 30;
export const EPIC_DESCRIPTION_PROMPT_MAX = 160;

export interface ExtractionMember {
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface ExtractionInput {
  /** Oldest first. */
  messages: BufferedMessage[];
  /** Extra instruction from the person running /task (e.g. a title or "assign to @an"). */
  note?: string;
  members: ExtractionMember[];
  timezone: string;
  now?: Date;
  /** The group's OPEN epics; the model may put a task in one ONLY when it clearly fits. */
  epics?: ExtractionEpic[];
}

export interface ExtractionEpic {
  title: string;
  description?: string | null;
}

export interface ExtractedTask {
  title: string;
  description?: string;
  /** One of TASK_TYPE_VALUES (bug, feature, improvement, task, chore, research, question). */
  type: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  /** Title of an existing epic, as the model returned it (resolved against the group's epics by code). */
  epic?: string;
  sourceMessageIds: number[];
}

export type ExtractionFallbackReason = 'unconfigured' | 'failed';

export interface ExtractionResult {
  tasks: ExtractedTask[];
  /** 'ai' when the model produced the tasks, 'fallback' for the deterministic basic task. */
  source: 'ai' | 'fallback';
  fallbackReason?: ExtractionFallbackReason;
}

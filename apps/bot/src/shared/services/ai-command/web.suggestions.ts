import { isClosedStatus } from '@tbot/shared';
import { refId } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { type Lang } from 'src/shared/services/ai-command/format';

// Follow-up suggestions (chips) under a web "Ask AI" answer, in the user's language.

const MAX_SUGGESTIONS = 3;

export const PHRASES: Record<Lang, {
  mine: string;
  overdue: string;
  open: string;
  assignMe: (n: number) => string;
  done: (n: number) => string;
  due: (n: number) => string;
  epics: string;
  epicLeft: (title: string) => string;
}> = {
  en: {
    mine: 'What are my open tasks?',
    overdue: "What's overdue?",
    open: 'What is still open?',
    assignMe: (n) => `Assign #${n} to me`,
    done: (n) => `Mark #${n} done`,
    due: (n) => `Set due date for #${n}`,
    epics: 'How are the epics going?',
    epicLeft: (title) => `What's left in epic ${title}?`,
  },
  vi: {
    mine: 'Tôi còn task nào?',
    overdue: 'Có gì quá hạn không?',
    open: 'Còn task nào đang mở?',
    assignMe: (n) => `Giao #${n} cho tôi`,
    done: (n) => `#${n} xong rồi`,
    due: (n) => `Đặt hạn cho #${n}`,
    epics: 'Tiến độ các epic',
    epicLeft: (title) => `Epic ${title} còn gì?`,
  },
};

export function pick(items: (string | false | null | undefined)[]): string[] {
  return Array.from(new Set(items.filter((s): s is string => !!s))).slice(0, MAX_SUGGESTIONS);
}

const isMine = (task: ITask, c: AiRequestContext) => refId(task.assigneeId) === c.requester._id.toString();

export function taskFollowUps(task: ITask, c: AiRequestContext, lang: Lang, offerAssign = true): string[] {
  const p = PHRASES[lang];
  return [
    offerAssign && !isMine(task, c) && !isClosedStatus(task.status) ? p.assignMe(task.taskNumber) : null,
    isMine(task, c) && !isClosedStatus(task.status) ? p.done(task.taskNumber) : null,
    !task.dueDate && !isClosedStatus(task.status) ? p.due(task.taskNumber) : null,
  ].filter((s): s is string => !!s);
}

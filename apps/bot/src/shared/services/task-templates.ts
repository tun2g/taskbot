import { TaskType } from '@tbot/shared';

/**
 * Description templates the AI fills per task type. The model returns the fields as JSON
 * (`details`), and the description text is rendered here, so every task of a type has the
 * same structure no matter how the source messages were written.
 */

export type TemplateField = 'problem' | 'steps' | 'expected' | 'goal' | 'context' | 'scope' | 'todo' | 'doneWhen' | 'question' | 'output' | 'askWho' | 'notes';

interface FieldSpec {
  field: TemplateField;
  /** Bullet list (array) or a single sentence (string). */
  list: boolean;
  /** What the model should put there. */
  hint: string;
}

const F = {
  problem: { field: 'problem', list: false, hint: "what is broken and where, from the user's point of view" },
  steps: { field: 'steps', list: true, hint: 'how to reproduce / when it happens (only if mentioned)' },
  expected: { field: 'expected', list: false, hint: 'the correct behaviour (only if stated or unambiguous)' },
  goal: { field: 'goal', list: false, hint: 'what should exist or change, and why (one sentence)' },
  context: { field: 'context', list: false, hint: 'background from the messages that explains the task' },
  scope: { field: 'scope', list: true, hint: 'concrete parts / items included' },
  todo: { field: 'todo', list: true, hint: 'concrete steps to do, in order' },
  doneWhen: { field: 'doneWhen', list: true, hint: 'checkable outcomes that mean it is finished — restate the request, never add new requirements' },
  question: { field: 'question', list: false, hint: 'the exact question to answer' },
  output: { field: 'output', list: false, hint: 'what to deliver (summary, comparison, recommendation…)' },
  askWho: { field: 'askWho', list: false, hint: 'who is expected to answer, if named' },
  notes: { field: 'notes', list: true, hint: 'links, devices, versions, numbers mentioned' },
} satisfies Record<TemplateField, FieldSpec>;

export const TASK_TEMPLATES: Record<TaskType, FieldSpec[]> = {
  [TaskType.BUG]: [F.problem, F.steps, F.expected, F.notes],
  [TaskType.FEATURE]: [F.goal, F.scope, F.doneWhen, F.notes],
  [TaskType.IMPROVEMENT]: [F.goal, F.scope, F.doneWhen, F.notes],
  [TaskType.TASK]: [F.context, F.todo, F.doneWhen, F.notes],
  [TaskType.CHORE]: [F.context, F.todo, F.doneWhen],
  [TaskType.RESEARCH]: [F.question, F.scope, F.output, F.notes],
  [TaskType.QUESTION]: [F.question, F.context, F.askWho],
};

const LABELS: Record<'vi' | 'en', Record<TemplateField, string>> = {
  en: {
    problem: 'Problem',
    steps: 'Steps to reproduce',
    expected: 'Expected',
    goal: 'Goal',
    context: 'Context',
    scope: 'Scope',
    todo: 'To do',
    doneWhen: 'Done when',
    question: 'Question',
    output: 'Deliverable',
    askWho: 'Needs an answer from',
    notes: 'Notes',
  },
  vi: {
    problem: 'Vấn đề',
    steps: 'Cách tái hiện',
    expected: 'Kết quả mong đợi',
    goal: 'Mục tiêu',
    context: 'Bối cảnh',
    scope: 'Phạm vi',
    todo: 'Việc cần làm',
    doneWhen: 'Hoàn thành khi',
    question: 'Câu hỏi',
    output: 'Kết quả cần có',
    askWho: 'Cần câu trả lời từ',
    notes: 'Ghi chú',
  },
};

export type TemplateDetails = Partial<Record<TemplateField, string | string[]>>;

// Vietnamese-only letters (with diacritics); enough to tell Vietnamese from English chat.
const VIETNAMESE = /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i;

export function detectLanguage(text: string): 'vi' | 'en' {
  return VIETNAMESE.test(text) ? 'vi' : 'en';
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Renders the filled template as plain text. Empty fields are left out (never "N/A"). */
export function renderTemplate(type: TaskType | string, details: TemplateDetails, language: 'vi' | 'en'): string | undefined {
  const specs = TASK_TEMPLATES[type as TaskType] ?? TASK_TEMPLATES[TaskType.TASK];
  const labels = LABELS[language];
  const blocks: string[] = [];
  for (const spec of specs) {
    const raw = details[spec.field];
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(clean).filter((v) => v && !/^(n\/?a|none|không có|-)$/i.test(v));
    if (items.length === 0) continue;
    if (spec.list || items.length > 1) blocks.push(`${labels[spec.field]}:\n${items.map((i) => `• ${i}`).join('\n')}`);
    else blocks.push(`${labels[spec.field]}: ${items[0]}`);
  }
  return blocks.length ? blocks.join('\n\n') : undefined;
}

/** Template section of the extraction prompt. */
export function describeTemplatesForPrompt(): string {
  const lines = Object.entries(TASK_TEMPLATES).map(([type, specs]) => {
    const fields = specs.map((s) => `${s.field}${s.list ? '[]' : ''} (${s.hint})`).join('; ');
    return `- ${type}: ${fields}`;
  });
  return lines.join('\n');
}

const TITLE_FILLER = /\s*\b(nhé|nha|nhá|ơi|giùm|giúp\s+(em|anh|chị|mình)|với|đi|please|pls|plz|asap|gấp|khẩn)\s*[.!…]*$/iu;

/** Final polish of an AI title: no @mentions, no trailing filler or punctuation, sentence case, ≤ 80 chars. */
export function cleanTitle(title: string, maxLength = 80): string {
  let t = title.replace(/@[A-Za-z0-9_]{2,}/g, ' ').replace(/\s+/g, ' ').trim();
  // Strip chat filler at the end, repeatedly ("fix login giúp em nhé")
  for (let i = 0; i < 3 && TITLE_FILLER.test(t); i++) t = t.replace(TITLE_FILLER, '').trim();
  t = t.replace(/[\s.,;:!?…-]+$/u, '').trim();
  if (t.length > maxLength) {
    const cut = t.slice(0, maxLength);
    const space = cut.lastIndexOf(' ');
    t = (space > maxLength * 0.6 ? cut.slice(0, space) : cut).trim() + '…';
  }
  return t ? t.charAt(0).toLocaleUpperCase('vi') + t.slice(1) : title.trim();
}

import type { AiChatResponse, AiChatTurn } from '@tbot/shared';

export interface UserMessage {
  id: string;
  role: 'user';
  text: string;
  /** Task the message was about (context chip), resent on Retry. */
  taskId?: string;
  /** Set when sending failed — the bubble shows it with Retry. */
  error?: string;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  response: AiChatResponse;
  /** Set after a successful Undo of `response.batchId`. */
  undone?: number;
}

export type ChatMessage = UserMessage | AssistantMessage;

const MAX_STORED = 30;
const MAX_HISTORY = 8;
const storageKey = (groupId: string) => `tbot.aichat.${groupId}`;

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadConversation(groupId: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(storageKey(groupId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === 'object' &&
        (((m as ChatMessage).role === 'user' && typeof (m as UserMessage).text === 'string') ||
          ((m as ChatMessage).role === 'assistant' && typeof (m as AssistantMessage).response?.text === 'string')),
    );
  } catch {
    return [];
  }
}

export function saveConversation(groupId: string, messages: ChatMessage[]) {
  try {
    if (messages.length === 0) sessionStorage.removeItem(storageKey(groupId));
    else sessionStorage.setItem(storageKey(groupId), JSON.stringify(messages.slice(-MAX_STORED)));
  } catch {
    // storage full / blocked — the conversation just won't survive a reload
  }
}

export function trimConversation(messages: ChatMessage[]): ChatMessage[] {
  return messages.length > MAX_STORED ? messages.slice(-MAX_STORED) : messages;
}

/** The last 8 successful turns before a message, as context for follow-ups. */
export function buildHistory(messages: ChatMessage[]): AiChatTurn[] {
  const turns: AiChatTurn[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.error) turns.push({ role: 'user', content: m.text });
    } else if (m.response.text) {
      turns.push({ role: 'assistant', content: m.response.text });
    }
  }
  return turns.slice(-MAX_HISTORY);
}

/*
 * Desktop only: when a chat link opens another page (task / board), the drawer reopens there so the
 * conversation stays in view. Read by the next page's useAskAi().
 */
let reopenRequestedAt = 0;
export function requestReopen() {
  reopenRequestedAt = Date.now();
}
export function consumeReopen(): boolean {
  // Only honoured right after the navigation, so a stale request never pops the drawer open later.
  // Not cleared on read: StrictMode runs state initializers twice in dev.
  return Date.now() - reopenRequestedAt < 2000;
}

export const STARTERS = {
  vi: ['Tôi còn task nào?', 'Có gì quá hạn không?', 'Tạo task: …', 'Chuyển #… cho @…'],
  en: ["What's on my plate?", "What's overdue?", 'Create a task: …', 'Assign #… to @…'],
};

export function starterChips(): string[] {
  const lang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return lang.toLowerCase().startsWith('vi') ? STARTERS.vi : STARTERS.en;
}

import type { ITask } from '@tbot/shared';
import { isClosedStatus } from '@tbot/shared';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useAiChat, useUndoBatch } from '@/api/ai';
import { useMe } from '@/api/auth';
import { useGroup } from '@/api/groups';
import type { BoardSearch } from '@/pages/tasks/board-search';
import { getErrorMessage } from '@/lib/api-client';
import { haptic } from '@/lib/telegram';
import { getUserId } from '@/lib/user';

import {
  type AssistantMessage,
  buildHistory,
  type ChatMessage,
  loadConversation,
  newId,
  requestReopen,
  saveConversation,
  starterChips,
  trimConversation,
  type UserMessage,
} from './ai-chat-store';
import { AiAvatar, AssistantBubble, SuggestionChips, ThinkingBubble, UserBubble } from './ai-message';

const MAX_LENGTH = 2000;
const COUNTER_FROM = 1800;

interface AiChatPanelProps {
  groupId: string;
  open: boolean;
  isDesktop: boolean;
  onClose: () => void;
  /** Opened from a task's page: the chat is "about" this task until the chip is removed. */
  contextTask?: ITask | null;
}

/** Board filters for "View all on board" — only what every shown task obviously has in common. */
function deriveBoardSearch(tasks: ITask[], meId?: string | null): BoardSearch {
  const search: BoardSearch = {};
  if (tasks.length < 2) return search;
  const assignees = new Set(tasks.map((t) => getUserId(t.assigneeId) ?? 'none'));
  if (assignees.size === 1) {
    const only = [...assignees][0];
    search.assignee = meId && only === meId ? 'me' : only;
  }
  if (tasks.every((t) => !isClosedStatus(t.status))) {
    search.view = 'list';
    search.category = 'open';
  }
  return search;
}

function shortTitle(title: string, max = 24): string {
  return title.length > max ? `${title.slice(0, max).trimEnd()}…` : title;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function AiChatPanel(props: AiChatPanelProps) {
  if (!props.open || typeof document === 'undefined') return null;
  // Keyed by group so switching groups loads that group's conversation.
  return createPortal(<AiChatPanelInner key={props.groupId} {...props} />, document.body);
}

function AiChatPanelInner({ groupId, isDesktop, onClose, contextTask }: AiChatPanelProps) {
  const navigate = useNavigate();
  const { data: group } = useGroup(groupId);
  const { data: me } = useMe();
  const chat = useAiChat(groupId);
  const undo = useUndoBatch();

  const [messages, setMessages] = useState<ChatMessage[]>(() => loadConversation(groupId));
  const [input, setInput] = useState('');
  const [dismissedTaskId, setDismissedTaskId] = useState<string | null>(null);
  const context = contextTask && contextTask._id !== dismissedTaskId ? contextTask : null;

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => saveConversation(groupId, messages), [groupId, messages]);

  // Focus the input on open; give focus back to whatever opened the panel on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Desktop: shift the page so the board stays visible next to the drawer. Mobile: lock page scroll.
  useEffect(() => {
    const root = document.documentElement;
    if (isDesktop) {
      root.dataset.aiDrawer = 'open';
      return () => {
        delete root.dataset.aiDrawer;
      };
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isDesktop]);

  // Desktop drawer isn't modal: Esc closes it even while focus is on the board.
  useEffect(() => {
    if (!isDesktop) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][aria-modal]:not([data-ai-chat])')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, onClose]);

  // Auto-scroll to the newest message.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, chat.isPending]);

  // Auto-grow the input up to ~6 lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const send = useCallback(
    (raw: string, retry?: UserMessage) => {
      const text = raw.trim().slice(0, MAX_LENGTH);
      if (!text || chat.isPending) return;

      let userMsg: UserMessage;
      let before: ChatMessage[];
      if (retry) {
        userMsg = { ...retry, error: undefined };
        const idx = messages.findIndex((m) => m.id === retry.id);
        before = idx >= 0 ? messages.slice(0, idx) : messages;
        setMessages((prev) => prev.map((m) => (m.id === retry.id ? userMsg : m)));
      } else {
        userMsg = { id: newId(), role: 'user', text, taskId: context?._id };
        before = messages;
        setMessages((prev) => trimConversation([...prev, userMsg]));
        setInput('');
      }
      haptic('light');

      const history = buildHistory(before);
      chat.mutate(
        { message: userMsg.text, taskId: userMsg.taskId, history: history.length ? history : undefined },
        {
          onSuccess: (response) => {
            const reply: AssistantMessage = { id: newId(), role: 'assistant', response };
            setMessages((prev) => trimConversation([...prev, reply]));
            if (response.kind === 'updated' || response.kind === 'created') haptic('success');
          },
          onError: (err) => {
            const message = getErrorMessage(err, "Couldn't reach the assistant.");
            setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, error: message } : m)));
            haptic('error');
          },
        },
      );
    },
    [chat, context, messages],
  );

  const handleUndo = async (message: AssistantMessage): Promise<string | null> => {
    const batchId = message.response.batchId;
    if (!batchId) return null;
    try {
      const { removed } = await undo.mutateAsync(batchId);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, undone: removed } : m)));
      haptic('success');
      return null;
    } catch (err) {
      haptic('error');
      return getErrorMessage(err, "Couldn't undo.");
    }
  };

  const leavePanelFor = (go: () => void) => {
    if (isDesktop) requestReopen();
    else onClose();
    go();
  };

  const openTask = (task: ITask) => {
    if (contextTask?._id === task._id) {
      if (!isDesktop) onClose();
      return;
    }
    leavePanelFor(() => navigate({ to: '/$groupId/tasks/$taskId', params: { groupId, taskId: task._id } }));
  };

  const viewAll = (tasks: ITask[]) => {
    const search = deriveBoardSearch(tasks, me?._id);
    leavePanelFor(() => navigate({ to: '/$groupId/tasks', params: { groupId }, search }));
  };

  const pickStarter = (text: string) => {
    const cut = text.indexOf('…');
    if (cut === -1) {
      send(text);
      return;
    }
    const prefill = text.slice(0, cut);
    setInput(prefill);
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(prefill.length, prefill.length);
    });
  };

  const newChat = () => {
    setMessages([]);
    setInput('');
    chat.reset();
    inputRef.current?.focus();
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    // Mobile sheet is modal: keep Tab inside it.
    if (e.key === 'Tab' && !isDesktop && panelRef.current) {
      const items = focusableIn(panelRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const lastAssistant = [...messages].reverse().find((m): m is AssistantMessage => m.role === 'assistant');
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant';
  const suggestions = lastIsAssistant && !chat.isPending ? (lastAssistant?.response.suggestions ?? []) : [];
  const groupName = group?.groupName ?? 'this group';

  const shell = isDesktop
    ? 'fixed inset-y-0 right-0 z-40 flex w-[400px] max-w-full flex-col border-l border-tg-separator bg-tg-bg shadow-xl'
    : 'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl bg-tg-bg shadow-xl';

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal={isDesktop ? undefined : true}
      aria-labelledby="ai-chat-title"
      data-ai-chat
      onKeyDown={onPanelKeyDown}
      className={shell}
      style={isDesktop ? undefined : { top: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
    >
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-tg-separator px-2">
        <h2 id="ai-chat-title" className="flex flex-1 items-center gap-2 px-2 text-base font-semibold text-tg-text">
          <span aria-hidden>✨</span> Ask AI
        </h2>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={newChat}
            disabled={chat.isPending}
            className="min-h-11 rounded-lg px-3 text-sm font-medium text-tg-link hover:bg-tg-secondary disabled:opacity-50"
          >
            New chat
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Ask AI"
          className="flex h-11 w-11 items-center justify-center rounded-full text-lg text-tg-hint hover:bg-tg-secondary"
        >
          ✕
        </button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-start gap-4 px-1 pt-2">
            <div className="flex items-start gap-2">
              <AiAvatar />
              <div className="rounded-2xl rounded-tl-md bg-tg-secondary px-3.5 py-2 text-sm text-tg-text">
                <p className="font-medium">Ask about or change tasks in {groupName}</p>
                <p className="mt-1 text-tg-hint">
                  {context
                    ? `I'll treat "this task" as #${context.taskNumber}.`
                    : 'Find tasks, create new ones, or reassign and update them.'}
                </p>
              </div>
            </div>
            <SuggestionChips items={starterChips()} onPick={pickStarter} disabled={chat.isPending} />
          </div>
        ) : (
          <ul className="flex flex-col gap-4" aria-live="polite" aria-relevant="additions">
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble
                  key={m.id}
                  message={m}
                  retryDisabled={chat.isPending}
                  onRetry={() => send(m.text, m)}
                />
              ) : (
                <AssistantBubble
                  key={m.id}
                  message={m}
                  timeZone={group?.timezone}
                  onOpenTask={openTask}
                  onViewAll={viewAll}
                  onUndo={handleUndo}
                />
              ),
            )}
            {chat.isPending && <ThinkingBubble />}
            {suggestions.length > 0 && (
              <li className="pl-9">
                <SuggestionChips items={suggestions} onPick={(s) => send(s)} />
              </li>
            )}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="shrink-0 border-t border-tg-separator bg-tg-bg px-3 pt-2"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        {context && (
          <div className="mb-2 flex">
            <span className="tint-link inline-flex max-w-full items-center rounded-full pl-3 text-xs font-medium">
              <span className="truncate">
                About #{context.taskNumber} · {shortTitle(context.title)}
              </span>
              <button
                type="button"
                onClick={() => setDismissedTaskId(context._id)}
                aria-label={`Stop asking about #${context.taskNumber}`}
                className="focus-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              >
                ✕
              </button>
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <label htmlFor="ai-chat-input" className="sr-only">
            Message to AI
          </label>
          <textarea
            id="ai-chat-input"
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={context ? `Ask about #${context.taskNumber}…` : 'Ask or tell AI what to change…'}
            className="min-h-11 flex-1 resize-none rounded-2xl border border-tg-separator bg-tg-section px-3.5 py-2.5 text-sm leading-5 text-tg-text outline-none placeholder:text-tg-hint focus:border-tg-link"
          />
          <button
            type="submit"
            disabled={!input.trim() || chat.isPending}
            aria-label="Send"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tg-button text-lg text-tg-button-text transition-opacity active:opacity-80 disabled:opacity-40"
          >
            ➤
          </button>
        </div>
        <div className="flex min-h-5 items-center justify-between gap-2 px-1 pt-1 text-[11px] text-tg-hint">
          <span className="hidden md:inline">Enter to send · Shift+Enter for a new line</span>
          {input.length >= COUNTER_FROM && (
            <span className={`ml-auto font-mono ${input.length >= MAX_LENGTH ? 'text-tg-destructive' : ''}`} aria-live="polite">
              {input.length}/{MAX_LENGTH}
            </span>
          )}
        </div>
      </form>
    </div>
  );

  if (isDesktop) return panel;
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} aria-hidden />
      {panel}
    </>
  );
}

import { GROUP_STATUS_LABELS, GroupStatus } from './group.js';

/**
 * Telegram texts (HTML parse mode) about a group's approval state. Shared so the bot (owner taps a button
 * in DM) and the admin API (owner clicks in the admin app) say exactly the same thing.
 */
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reasonLine = (reason?: string | null) => (reason?.trim() ? `\nReason: ${esc(reason.trim())}` : '');

export const GROUP_NOTICES = {
  /** Posted once in the group when the bot is added and waits for approval. */
  pending: (botName: string) =>
    `👋 Thanks for adding ${esc(botName)}!\n\n` +
    "⏳ The bot's owner (the person who runs this bot, not your group admins) approves new groups first — " +
    'usually within a day. You\'ll see a message here when it\'s done.\n\n' +
    "Until then the bot stays quiet and doesn't save messages sent here, so there's nothing to do yet.",
  /** Short reply when someone uses the bot while the group is still pending (rate-limited by the bot). */
  stillPending:
    "⏳ The bot can't help yet — this group is waiting for the bot owner's approval. " +
    "Messages sent now aren't saved, so try again after the \"approved\" message appears here.",
  /**
   * Posted in the group's main chat (General in a forum). `forum`: say where task updates will show up, since
   * the bot posts them in a separate “Task events” topic.
   */
  approved: (botName: string, opts: { forum?: boolean } = {}) =>
    `✅ This group is approved — ${esc(botName)} is ready.\n\n` +
    '• <code>/new Fix login on iOS</code> creates a task\n' +
    '• Reply to any message with /new to turn it into a task\n' +
    (opts.forum ? '• New tasks and updates go to a “Task events” topic — /settopic picks another one\n' : '') +
    '• /help shows everything else',
  /** `ownerContact` (OWNER_CONTACT, e.g. "@tun2g"): how to reach the owner once the bot is gone; omitted when unset. */
  rejected: (reason?: string | null, ownerContact?: string | null) =>
    `🚫 The bot's owner did not approve this group, so the bot is leaving.${reasonLine(reason)}\n\n` +
    (ownerContact?.trim()
      ? `If you think this is a mistake, message the bot's owner: ${esc(ownerContact.trim())}. Adding the bot again sends a new request.`
      : 'If you think this is a mistake, ask the person who runs this bot. Adding the bot again sends a new request.'),
  suspended: (reason?: string | null, ownerContact?: string | null) =>
    `⏸ The bot's owner paused the bot in this group.${reasonLine(reason)}\n\n` +
    "Your tasks are kept. Until it's back, commands, buttons, reminders and the task board don't work here. " +
    "You'll see a message here when it resumes." +
    (ownerContact?.trim() ? `\n\nQuestions? Message the bot's owner: ${esc(ownerContact.trim())}` : ''),
  /** Short reply when someone uses the bot in a suspended group (rate-limited by the bot). */
  stillSuspended: (reason?: string | null) =>
    `⏸ The bot is paused in this group by its owner, so it can't do that now.${reasonLine(reason)}\n` +
    "Your tasks are kept — you'll see a message here when it's back.",
  unsuspended: '▶️ The bot is back. Commands, buttons, reminders and the task board work again — your tasks are where you left them.',
  leaving: (reason?: string | null) =>
    `👋 The bot's owner removed the bot from this group.${reasonLine(reason)}\n\nYour tasks are kept if the bot is added back later.`,
  /**
   * After a group became a supergroup, an update from the new chat may have arrived first and posted the
   * "waiting for approval" note there. The group was approved all along: say so instead of leaving it confusing.
   */
  migratedStillActive: "✅ Never mind the note above: Telegram upgraded this chat and the bot briefly took it for a new group. It's already approved, so everything keeps working.",
} as const;

/** Ready-made reasons for the owner's Reject button in Telegram (shown to the group, so written for its members). */
export const GROUP_REJECT_REASONS = {
  private: 'This bot is private — it only works in groups its owner set it up for.',
  team: "This chat doesn't look like a team that tracks work together.",
} as const;
export type GroupRejectReasonKey = keyof typeof GROUP_REJECT_REASONS;

export interface OwnerApprovalInfo {
  groupName: string;
  /** Who added the bot, e.g. "@an" or "An Nguyen". */
  addedBy: string | null;
  memberCount: number | null;
  isForum: boolean;
  /** Public t.me link or null. */
  link: string | null;
  /** Earlier decisions about this chat, e.g. "Rejected on 2026-10-20: spam". */
  history?: string | null;
}

/**
 * The owner's DM card for a group waiting for approval, and its final state after a decision. `by`: where the
 * decision was made — 'telegram' reads "here" (this card), 'admin' "in the admin app", null when unknown (no wording).
 */
export function ownerApprovalText(
  info: OwnerApprovalInfo,
  decided?: { status: GroupStatus; by: 'telegram' | 'admin' | null; reason?: string | null },
): string {
  const lines = [
    decided ? '' : '🆕 <b>New group wants to use the bot</b>',
    `<b>${esc(info.groupName)}</b>${info.isForum ? ' (topics)' : ''}`,
    `Added by: ${info.addedBy ? esc(info.addedBy) : 'unknown'}`,
    `Members: ${info.memberCount ?? 'unknown'}`,
    ...(info.link ? [`Link: ${esc(info.link)}`] : []),
    ...(info.history ? [`History: ${esc(info.history)}`] : []),
  ].filter(Boolean);
  if (!decided) {
    lines.push('', 'The bot stays quiet in this group until you approve it. Reject asks for a reason, which the group sees.');
  } else {
    const where = decided.by === 'admin' ? ' in the admin app' : decided.by === 'telegram' ? ' here' : '';
    const verdict =
      decided.status === GroupStatus.ACTIVE
        ? `✅ Approved${where}`
        : decided.status === GroupStatus.REJECTED
          ? `🚫 Rejected${where} — the bot left`
          : `ℹ️ Now: ${GROUP_STATUS_LABELS[decided.status]}`;
    lines.unshift(verdict);
    if (decided.reason?.trim()) lines.push(`Reason: ${esc(decided.reason.trim())}`);
  }
  return lines.join('\n');
}

import { BufferedMention } from 'src/shared/services/message-buffer.service';
import { ExtractionMember } from 'src/shared/services/task-extraction/types';

/** Matches the AI's assignee string to a group member. Never trusts the AI with ids. */
export function resolveMember<T extends ExtractionMember>(
  name: string,
  members: T[],
  mentions: BufferedMention[] = [],
): T | null {
  const raw = name.trim();
  if (!raw) return null;
  const lower = raw.replace(/^@/, '').toLowerCase();

  // 1. @username (case-insensitive)
  const byUsername = members.find((m) => m.username && m.username.toLowerCase() === lower);
  if (byUsername) return byUsername;

  const unique = (list: T[]) => (list.length === 1 ? list[0] : null);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = norm(raw);

  // 2. exact full name, then first name (only when unambiguous)
  const byFull = unique(members.filter((m) => norm([m.firstName, m.lastName].filter(Boolean).join(' ')) === target));
  if (byFull) return byFull;
  const byFirst = unique(members.filter((m) => m.firstName && norm(m.firstName) === target));
  if (byFirst) return byFirst;

  // 3. text_mention entities in the source messages (users without a username)
  const tagged = mentions.find(
    (x) => x.telegramUserId && (norm(x.text) === target || norm(x.text).replace(/^@/, '') === lower),
  );
  if (tagged) {
    const byId = members.find((m) => m.telegramUserId === tagged.telegramUserId);
    if (byId) return byId;
  }
  return null;
}

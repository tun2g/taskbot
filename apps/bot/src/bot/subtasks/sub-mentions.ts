import type { MessageEntity } from 'telegraf/types';

// Tap-mentions of people without a @username arrive as plain text ("Bình") plus a text_mention entity.
// Before parsing /sub we swap each such span for a token "@__tm<i>" (usernames can't start with "_"),
// so "Write tests Bình" parses like "Write tests @__tm0" and the token maps back to that user's id.

const TOKEN = /^@__tm(\d+)$/;

export interface TaggedText {
  text: string;
  /** Telegram user id per token index. */
  taggedIds: number[];
  /** The mention's original text per token index (to put back where a token isn't the assignee). */
  names: string[];
}

export function tagTextMentions(text: string, entities: MessageEntity[] = []): TaggedText {
  const mentions = entities
    .filter((e): e is MessageEntity.TextMentionMessageEntity => e.type === 'text_mention' && !!e.user)
    .sort((a, b) => b.offset - a.offset);
  const taggedIds: number[] = [];
  const names: string[] = [];
  let out = text;
  // Back to front, so earlier offsets (UTF-16, like JS strings) stay valid.
  mentions.forEach((e, i) => {
    const index = mentions.length - 1 - i;
    taggedIds[index] = e.user.id;
    names[index] = text.slice(e.offset, e.offset + e.length);
    out = `${out.slice(0, e.offset)}@__tm${index}${out.slice(e.offset + e.length)}`;
  });
  return { text: out, taggedIds, names };
}

/** Puts the original names back in place of any token left inside a title. */
export function untag(text: string, names: string[]): string {
  return text.replace(/@__tm(\d+)/g, (token, i) => names[Number(i)] ?? token);
}

/** The Telegram user id behind a "@__tm<i>" token, or null for a normal "@name". */
export function taggedUserId(assignee: string, taggedIds: number[]): number | null {
  const m = assignee.match(TOKEN);
  return m ? (taggedIds[Number(m[1])] ?? null) : null;
}

// Parses the text after /sub. Pure, so the rules are easy to test.
//   /sub 42 Write tests @an          → parent #42, one subtask
//   /sub #42                         → parent #42, one subtask per following line
//   (reply to a card) /sub Write tests @an\nUpdate docs → the card's task, one subtask per line

export const SUBS_PER_COMMAND_MAX = 10;
const TITLE_MAX = 200;

export interface SubItem {
  title: string;
  /** "@an" when the line ends with a mention. */
  assignee?: string;
}

export interface ParsedSub {
  /** Task number from the text; absent when the parent comes from the replied card. */
  parentNumber?: number;
  items: SubItem[];
  /** Lines past SUBS_PER_COMMAND_MAX that were left out. */
  dropped: number;
}

function toItem(line: string): SubItem | null {
  let title = line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
  let assignee: string | undefined;
  // "@an", "@Bình" (names typed with @), or a "@__tm0" token for a tap-mention (see sub-mentions.ts).
  const trailing = title.match(/\s+(@[\p{L}\p{N}_]+)\s*$/u);
  if (trailing && trailing.index! > 0) {
    assignee = trailing[1];
    title = title.slice(0, trailing.index).trim();
  }
  if (!title) return null;
  return { title: title.slice(0, TITLE_MAX), ...(assignee ? { assignee } : {}) };
}

/** `args` = message text without "/sub"; `hasCardParent` = the command replies to a task card. */
export function parseSubArgs(args: string, hasCardParent: boolean): ParsedSub {
  let body = args.trim();
  let parentNumber: number | undefined;
  if (!hasCardParent) {
    const m = body.match(/^#?(\d+)(?=\s|$)/);
    if (m) {
      parentNumber = parseInt(m[1], 10);
      body = body.slice(m[0].length).trim();
    }
  }
  const all = body
    .split('\n')
    .map(toItem)
    .filter((item): item is SubItem => item !== null);
  return { parentNumber, items: all.slice(0, SUBS_PER_COMMAND_MAX), dropped: Math.max(0, all.length - SUBS_PER_COMMAND_MAX) };
}

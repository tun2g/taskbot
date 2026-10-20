import type { EpicWithProgress, IEpic, ITask } from '@tbot/shared';
import { EPIC_AUTO_COLORS, EpicColor, TaskStatusCategory } from '@tbot/shared';

export interface EpicColorClasses {
  /** Solid fill: dots, swatches, progress bars. */
  solid: string;
  /** Soft chip: tinted background + readable text in light and dark themes. */
  chip: string;
  /** Human name for screen readers / swatch labels. */
  name: string;
  /** Text color on top of `solid` (the ✓ in the swatch picker). */
  onSolid: string;
}

/**
 * EpicColor → Tailwind classes. Mid-saturation fills read on both white and #212121; chip text uses 700–900 in light
 * and 200–300 in dark (`dark:` follows Telegram's color scheme). Yellow / brown text goes darker for contrast.
 * Order and names match the chat's square emoji (🟦🟩🟧🟪🟥🟨🟫⬜).
 */
export const EPIC_COLOR_CLASSES: Record<EpicColor, EpicColorClasses> = {
  [EpicColor.BLUE]: {
    solid: 'bg-blue-500',
    chip: 'bg-blue-500/12 text-blue-700 dark:text-blue-300',
    name: 'Blue',
    onSolid: 'text-white',
  },
  [EpicColor.GREEN]: {
    solid: 'bg-green-500',
    chip: 'bg-green-500/12 text-green-700 dark:text-green-300',
    name: 'Green',
    onSolid: 'text-white',
  },
  [EpicColor.ORANGE]: {
    solid: 'bg-orange-500',
    chip: 'bg-orange-500/14 text-orange-700 dark:text-orange-300',
    name: 'Orange',
    onSolid: 'text-white',
  },
  [EpicColor.PURPLE]: {
    solid: 'bg-purple-500',
    chip: 'bg-purple-500/12 text-purple-700 dark:text-purple-300',
    name: 'Purple',
    onSolid: 'text-white',
  },
  [EpicColor.RED]: {
    solid: 'bg-red-500',
    chip: 'bg-red-500/12 text-red-700 dark:text-red-300',
    name: 'Red',
    onSolid: 'text-white',
  },
  [EpicColor.YELLOW]: {
    solid: 'bg-yellow-400',
    chip: 'bg-yellow-400/20 text-yellow-800 dark:text-yellow-200',
    name: 'Yellow',
    onSolid: 'text-gray-900',
  },
  [EpicColor.BROWN]: {
    solid: 'bg-amber-800',
    chip: 'bg-amber-800/14 text-amber-900 dark:bg-amber-700/25 dark:text-amber-200',
    name: 'Brown',
    onSolid: 'text-white',
  },
  [EpicColor.GRAY]: {
    solid: 'bg-gray-400',
    chip: 'bg-gray-500/14 text-gray-700 dark:text-gray-300',
    name: 'Gray',
    onSolid: 'text-white',
  },
};

export function epicColorClasses(color: EpicColor | string | undefined | null): EpicColorClasses {
  return EPIC_COLOR_CLASSES[color as EpicColor] ?? EPIC_COLOR_CLASSES[EpicColor.GRAY];
}

/** The bits of an epic a task chip needs. */
export type EpicRef = Pick<IEpic, '_id' | 'title' | 'color' | 'status'>;

export function getEpicId(ref: ITask['epicId']): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : (ref._id ?? null);
}

/** A task's epic as an object — populated by the API, or looked up in the group's epic list. */
export function resolveEpic(ref: ITask['epicId'], epics?: EpicRef[]): EpicRef | null {
  if (!ref) return null;
  if (typeof ref !== 'string') return ref;
  return epics?.find((e) => e._id === ref) ?? null;
}

/**
 * Least-used color in the group (ties → palette order), so new epics look distinct. Never red — it reads as
 * "urgent", so it's only used when someone picks it (same rule as the bot).
 */
export function suggestEpicColor(epics: Pick<IEpic, 'color'>[]): EpicColor {
  const used = new Map<EpicColor, number>();
  for (const e of epics) used.set(e.color, (used.get(e.color) ?? 0) + 1);
  return EPIC_AUTO_COLORS.reduce((best, c) => ((used.get(c) ?? 0) < (used.get(best) ?? 0) ? c : best));
}

export function epicPercent(epic: Pick<EpicWithProgress, 'progress'>): number {
  const { total, done } = epic.progress;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** One part of "3 of 8 done · 2 in progress · 3 to do" — each opens the board filtered to that category. */
export interface EpicProgressSegment {
  category: TaskStatusCategory;
  count: number;
  label: string;
}

export interface EpicProgressText {
  total: number;
  done: number;
  inProgress: number;
  todo: number;
  /** Cancelled tasks still in the epic — not part of `total`. */
  cancelled: number;
  /** Not done yet (to do + in progress). */
  open: number;
  pct: number;
  /** "38% done" ('' without tasks). */
  pctLabel: string;
  /** "3 of 8 done · 2 in progress · 3 to do", or "No tasks yet". */
  summary: string;
  /** Picker / filter hint: "38% done · 3 of 8 tasks", or "No tasks yet". */
  short: string;
  /** The parts of `summary` (empty without tasks). */
  segments: EpicProgressSegment[];
}

/**
 * The one way the app words an epic's progress (rows, pickers, filters). Cancelled tasks are left out of every
 * number, so the parts add up to the total.
 */
export function formatEpicProgress(epic: Pick<EpicWithProgress, 'progress'>): EpicProgressText {
  const { total = 0, done = 0, inProgress = 0, cancelled = 0 } = epic.progress ?? {};
  const todo = Math.max(0, total - done - inProgress);
  const pct = epicPercent({ progress: { total, done, inProgress, cancelled } });
  const segments: EpicProgressSegment[] =
    total === 0
      ? []
      : [
          { category: TaskStatusCategory.DONE, count: done, label: `${done} of ${total} done` },
          ...(inProgress > 0
            ? [{ category: TaskStatusCategory.IN_PROGRESS, count: inProgress, label: `${inProgress} in progress` }]
            : []),
          ...(todo > 0 ? [{ category: TaskStatusCategory.TODO, count: todo, label: `${todo} to do` }] : []),
        ];
  return {
    total,
    done,
    inProgress,
    todo,
    cancelled,
    open: total - done,
    pct,
    pctLabel: total > 0 ? `${pct}% done` : '',
    summary: total === 0 ? 'No tasks yet' : segments.map((s) => s.label).join(' · '),
    short: total === 0 ? 'No tasks yet' : `${pct}% done · ${done} of ${total} task${total === 1 ? '' : 's'}`,
    segments,
  };
}

/** Every task in the epic, cancelled ones included (what a delete unlinks). */
export function epicTaskCount(epic: Pick<EpicWithProgress, 'progress'>): number {
  return (epic.progress?.total ?? 0) + (epic.progress?.cancelled ?? 0);
}

/** A Mongo ObjectId (24 hex chars) — the shape of every epic / task / member id in URLs. */
export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
}

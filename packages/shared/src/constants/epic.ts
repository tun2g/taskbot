/** Epic colors — named so the bot can show a matching emoji and the web a matching swatch. */
export enum EpicColor {
  BLUE = 'blue',
  GREEN = 'green',
  ORANGE = 'orange',
  PURPLE = 'purple',
  RED = 'red',
  YELLOW = 'yellow',
  BROWN = 'brown',
  GRAY = 'gray',
}

export const EPIC_COLOR_ORDER: EpicColor[] = [
  EpicColor.BLUE,
  EpicColor.GREEN,
  EpicColor.ORANGE,
  EpicColor.PURPLE,
  EpicColor.RED,
  EpicColor.YELLOW,
  EpicColor.BROWN,
  EpicColor.GRAY,
];

export const EPIC_COLOR_VALUES = EPIC_COLOR_ORDER as [EpicColor, ...EpicColor[]];

/**
 * Telegram has no colored text, so chat messages show the epic as a colored SQUARE — squares never look like the
 * round priority / status dots, and all of these render on older phones (Unicode 12, 2019; ⬜ much older).
 */
export const EPIC_COLOR_EMOJI: Record<EpicColor, string> = {
  [EpicColor.BLUE]: '🟦',
  [EpicColor.GREEN]: '🟩',
  [EpicColor.ORANGE]: '🟧',
  [EpicColor.PURPLE]: '🟪',
  [EpicColor.RED]: '🟥',
  [EpicColor.YELLOW]: '🟨',
  [EpicColor.BROWN]: '🟫',
  [EpicColor.GRAY]: '⬜',
};

/** Red reads as "urgent / blocked", so it's never picked automatically — only when a user chooses it. */
export const EPIC_AUTO_COLORS: EpicColor[] = EPIC_COLOR_ORDER.filter((c) => c !== EpicColor.RED);

export enum EpicStatus {
  OPEN = 'open',
  DONE = 'done',
}

export const EPIC_STATUS_VALUES = [EpicStatus.OPEN, EpicStatus.DONE] as [EpicStatus, ...EpicStatus[]];

export const EPIC_TITLE_MAX = 80;

/**
 * Pass to <Table className> to show each row as a stacked card below the `sm` breakpoint, so a wide table's
 * last columns (counts, actions) never scroll off a phone screen. Header cells are hidden on phones; give a
 * cell a phone-only label with <StackLabel> (or `sm:hidden`) and `STACK_PAIR` to put the label and value on
 * one line.
 */
export const STACK_ON_MOBILE =
  'max-sm:[&_table]:block max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:block max-sm:[&_tr]:py-3 ' +
  'max-sm:[&_td]:block max-sm:[&_td]:px-5 max-sm:[&_td]:py-1.5 max-sm:[&_td]:text-left';

/** A cell shown as "label … value" on one line on phones. */
export const STACK_PAIR = 'max-sm:flex! max-sm:items-center max-sm:justify-between max-sm:gap-3';

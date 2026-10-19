import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_CATEGORY,
  TASK_STATUS_CATEGORY_LABELS,
  TASK_STATUS_HINTS,
  TASK_STATUS_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_LABELS,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
  TaskType,
} from '@tbot/shared';

import { splitLabel, StatusLozenge, statusText } from './badges';
import type { SelectOption, SelectSection } from './select-menu';

/** Option lists for SelectMenu, shared by filters, the create modal and the detail panel. */
export const TYPE_OPTIONS: SelectOption<TaskType>[] = TASK_TYPE_ORDER.map((t) => {
  const { icon, text } = splitLabel(TASK_TYPE_LABELS[t]);
  return { value: t, label: text, icon, hint: TASK_TYPE_HINTS[t] };
});

export const PRIORITY_OPTIONS: SelectOption<TaskPriority>[] = TASK_PRIORITY_ORDER.map((p) => {
  const { icon, text } = splitLabel(TASK_PRIORITY_LABELS[p]);
  return { value: p, label: text, icon };
});

export const STATUS_CATEGORIES = [TaskStatusCategory.TODO, TaskStatusCategory.IN_PROGRESS, TaskStatusCategory.DONE];

export const statusesIn = (cat: TaskStatusCategory) => TASK_STATUS_ORDER.filter((s) => TASK_STATUS_CATEGORY[s] === cat);

/** Statuses grouped by category (To do / In progress / Done), rendered as lozenges. */
export const STATUS_SECTIONS: SelectSection<TaskStatus>[] = STATUS_CATEGORIES.map((cat) => ({
  label: splitLabel(TASK_STATUS_CATEGORY_LABELS[cat]).text,
  options: statusesIn(cat).map((s) => ({
    value: s,
    label: statusText(s),
    hint: TASK_STATUS_HINTS[s],
    content: <StatusLozenge status={s} />,
  })),
}));

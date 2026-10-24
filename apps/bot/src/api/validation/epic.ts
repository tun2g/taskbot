import { EPIC_COLOR_VALUES, EPIC_STATUS_VALUES, EPIC_TITLE_MAX } from '@tbot/shared';
import { z } from 'zod';
import { choices, description, objectIdString } from 'src/api/validation/fields';

const epicTitle = z
  .string({ error: 'Please enter an epic name.' })
  .trim()
  .min(1, 'Please enter an epic name.')
  .max(EPIC_TITLE_MAX, `The epic name must be ${EPIC_TITLE_MAX} characters or fewer.`);
const epicColor = z.enum(EPIC_COLOR_VALUES, {
  error: `Choose a valid color: ${choices([...EPIC_COLOR_VALUES])}.`,
});
const epicStatus = z.enum(EPIC_STATUS_VALUES, { error: 'Choose a valid epic status: open or done.' });

/** POST /api/groups/:groupId/epics (CreateEpicInput). */
export const createEpicSchema = z.object({
  title: epicTitle,
  description: description.optional(),
  color: epicColor.optional(),
  /** Undo of a delete: recreate it as it was (open / done)… */
  status: epicStatus.optional(),
  /** …and put its tasks back (only tasks of this group without an epic are linked). */
  taskIds: z
    .array(objectIdString('Some of those tasks could not be found.'), { error: 'taskIds must be a list of task ids.' })
    .max(1000, 'Too many tasks to restore at once.')
    .optional(),
});

/** PATCH /api/epics/:epicId (UpdateEpicInput). */
export const updateEpicSchema = z.object({
  title: epicTitle.optional(),
  description: description.nullable().optional(),
  color: epicColor.optional(),
  status: epicStatus.optional(),
});

import { z } from 'zod';
import { objectIdString } from 'src/api/validation/fields';

export const telegramLoginSchema = z
  .object({
    id: z.number().int(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    photo_url: z.string().optional(),
    auth_date: z.number().int(),
    hash: z.string(),
  })
  .passthrough();

export const AI_MESSAGE_MAX = 2000;
export const AI_HISTORY_MAX = 20;

/** POST /api/groups/:groupId/ai (AiChatRequest). The server uses only the last 8 history turns. */
export const aiChatSchema = z.object({
  message: z
    .string({ error: 'Please type a message.' })
    .trim()
    .min(1, 'Please type a message.')
    .max(AI_MESSAGE_MAX, `Messages can be at most ${AI_MESSAGE_MAX} characters.`),
  taskId: objectIdString('This task could not be found. Please reopen it and try again.').optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant'], { error: 'The conversation history is invalid.' }),
        content: z.string({ error: 'The conversation history is invalid.' }).max(4000, 'The conversation history is too long.'),
      }),
      { error: 'The conversation history is invalid.' },
    )
    .max(AI_HISTORY_MAX, `The conversation history can have at most ${AI_HISTORY_MAX} messages.`)
    .optional(),
});

import { z } from 'zod';

export const jobQuery = z.object({
  name: z.string().max(100).optional(),
  cron: z.string().max(100).optional(),
});

export const runSchema = z.object({
  name: z.string({ message: 'Say which job to run.' }).min(1).max(100),
  cron: z.string().max(100).nullable(),
});

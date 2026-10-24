import { z } from 'zod';

/** GET /auth/link-status?requestId= */
export const statusSchema = z.object({ requestId: z.string().max(100) });

/** POST /auth/exchange */
export const exchangeSchema = z.object({
  code: z.string({ message: 'The login link is missing its code.' }).min(1).max(200),
});

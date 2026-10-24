import { Router } from 'express';
import { calls, refused, usage } from 'src/modules/ai/ai.controller';
import { asyncHandler } from 'src/shared/http';

export const aiRouter: Router = Router();

aiRouter.get('/usage', asyncHandler(usage));
aiRouter.get('/refused', asyncHandler(refused));
aiRouter.get('/calls', asyncHandler(calls));

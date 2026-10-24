import { Router } from 'express';
import { getAi, putAi } from 'src/modules/settings/settings.controller';
import { asyncHandler } from 'src/shared/http';

export const settingsRouter: Router = Router();

settingsRouter.get('/ai', asyncHandler(getAi));
settingsRouter.put('/ai', asyncHandler(putAi));

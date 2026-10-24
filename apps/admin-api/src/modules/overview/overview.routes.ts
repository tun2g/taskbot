import { Router } from 'express';
import { getOverview } from 'src/modules/overview/overview.controller';
import { asyncHandler } from 'src/shared/http';

export const overviewRouter: Router = Router();

overviewRouter.get('/', asyncHandler(getOverview));

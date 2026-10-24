import { Router } from 'express';
import { getJobFailures, getStatus, postRunJob } from 'src/modules/system/system.controller';
import { asyncHandler } from 'src/shared/http';

export const systemRouter: Router = Router();

systemRouter.get('/', asyncHandler(getStatus));
systemRouter.get('/jobs/failures', asyncHandler(getJobFailures));
systemRouter.post('/jobs/run', asyncHandler(postRunJob));

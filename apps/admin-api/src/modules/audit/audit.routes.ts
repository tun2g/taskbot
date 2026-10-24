import { Router } from 'express';
import { getAuditLog } from 'src/modules/audit/audit.controller';
import { asyncHandler } from 'src/shared/http';

export const auditRouter: Router = Router();

auditRouter.get('/', asyncHandler(getAuditLog));

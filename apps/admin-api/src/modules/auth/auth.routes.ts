import { Router } from 'express';
import { requireOwner } from 'src/modules/auth/auth.middleware';
import {
  exchange,
  linkStatus,
  logoutAll,
  logoutHandler,
  me,
  requestLink,
} from 'src/modules/auth/controllers/login.controller';
import { listSessionsHandler, revokeSessionHandler } from 'src/modules/auth/controllers/sessions.controller';
import { asyncHandler } from 'src/shared/http';

/** Re-exported for the tests. */
export { LINK_LIMIT_GLOBAL, LINK_LIMIT_PER_IP } from 'src/modules/auth/services/login.service';

export const authRouter: Router = Router();

// The owner's signed-in browsers ("Active sessions" in the account menu).
authRouter.get('/sessions', requireOwner, asyncHandler(listSessionsHandler));
authRouter.post('/sessions/:id/revoke', requireOwner, asyncHandler(revokeSessionHandler));

authRouter.post('/request-link', asyncHandler(requestLink));
authRouter.get('/link-status', asyncHandler(linkStatus));
authRouter.post('/exchange', asyncHandler(exchange));
authRouter.post('/logout', asyncHandler(logoutHandler));
authRouter.post('/logout-all', requireOwner, asyncHandler(logoutAll));
authRouter.get('/me', requireOwner, asyncHandler(me));

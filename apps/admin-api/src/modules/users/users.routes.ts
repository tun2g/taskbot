import { Router } from 'express';
import { detail, list, patchAi, revokeTokens } from 'src/modules/users/users.controller';
import { asyncHandler } from 'src/shared/http';

export const usersRouter: Router = Router();

usersRouter.get('/', asyncHandler(list));
usersRouter.get('/:id', asyncHandler(detail));
usersRouter.patch('/:id/ai', asyncHandler(patchAi));
usersRouter.post('/:id/revoke-tokens', asyncHandler(revokeTokens));

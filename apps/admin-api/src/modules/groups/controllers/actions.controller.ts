import { GroupDecision } from '@tbot/db';
import { Request, Response } from 'express';
import { actionSchema, actionWithReasonSchema } from 'src/modules/groups/groups.schemas';
import {
  actionResponse,
  applyDecision,
  applyLeave,
  applyReconsider,
  updateGroupAi,
} from 'src/modules/groups/services/actions.service';
import { aiOverrideSchema } from 'src/shared/ai-override';
import { objectIdParam, parseOr400 } from 'src/shared/http';

export const DECISIONS = ['approve', 'reject', 'suspend', 'unsuspend'] as const satisfies readonly GroupDecision[];

// POST /groups/:id/{approve|reject|suspend|unsuspend}
export function decide(decision: (typeof DECISIONS)[number]) {
  return async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const input = parseOr400(
      decision === 'reject' || decision === 'suspend' ? actionWithReasonSchema : actionSchema,
      req.body,
    );
    res.json({ data: await actionResponse(await applyDecision(req, id, decision, input)) });
  };
}

// POST /groups/:id/leave { reason?, notifyGroup? }
export async function leave(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  const input = parseOr400(actionSchema, req.body);
  res.json({ data: await actionResponse(await applyLeave(req, id, input)) });
}

// POST /groups/:id/reconsider {} — rejected → bot removed (undecided): the next re-add asks for approval again.
export async function reconsider(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  res.json({ data: await actionResponse(await applyReconsider(req, id)) });
}

// PATCH /groups/:id/ai { disabled?, dailyLimit?, reason? }
export async function patchAi(req: Request, res: Response) {
  const id = objectIdParam(req.params.id, 'group');
  const input = parseOr400(aiOverrideSchema, req.body);
  res.json({ data: await updateGroupAi(req, id, input) });
}

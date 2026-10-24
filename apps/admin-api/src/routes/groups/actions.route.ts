import { Group, SETTINGS_CACHE_SECONDS } from '@tbot/db';
import type { AdminGroupRow } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { aiOverrideSet, overrideSnapshot } from 'src/routes/ai-override';
import { applyDecision, applyLeave, applyReconsider } from 'src/routes/group-actions';
import { groupRows, LeanGroup } from 'src/routes/group-rows';
import { actionSchema, actionWithReasonSchema, aiOverrideSchema } from 'src/routes/schemas';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, objectIdParam, parseOr400 } from 'src/shared/http';
import { findGroup } from './find-group';

export const actionsRouter: Router = Router();

type ActionRow = AdminGroupRow & { warnings: string[] };

async function actionResponse(outcome: { group: LeanGroup; warnings: string[] }): Promise<ActionRow> {
  const [row] = await groupRows([outcome.group]);
  return { ...row, warnings: outcome.warnings };
}

// POST /groups/:id/{approve|reject|suspend|unsuspend}
for (const decision of ['approve', 'reject', 'suspend', 'unsuspend'] as const) {
  actionsRouter.post(
    `/:id/${decision}`,
    asyncHandler(async (req: Request, res: Response) => {
      const id = objectIdParam(req.params.id, 'group');
      const input = parseOr400(decision === 'reject' || decision === 'suspend' ? actionWithReasonSchema : actionSchema, req.body);
      res.json({ data: await actionResponse(await applyDecision(req, id, decision, input)) });
    }),
  );
}

// POST /groups/:id/leave { reason?, notifyGroup? }
actionsRouter.post(
  '/:id/leave',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const input = parseOr400(actionSchema, req.body);
    res.json({ data: await actionResponse(await applyLeave(req, id, input)) });
  }),
);

// POST /groups/:id/reconsider {} — rejected → bot removed (undecided): the next re-add asks for approval again.
actionsRouter.post(
  '/:id/reconsider',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    res.json({ data: await actionResponse(await applyReconsider(req, id)) });
  }),
);

// PATCH /groups/:id/ai { disabled?, dailyLimit?, reason? }
actionsRouter.patch(
  '/:id/ai',
  asyncHandler(async (req: Request, res: Response) => {
    const id = objectIdParam(req.params.id, 'group');
    const input = parseOr400(aiOverrideSchema, req.body);
    const before = await findGroup(id);
    await Group.updateOne({ _id: id }, { $set: aiOverrideSet(input, before.ai) });
    const after = await findGroup(id);
    const auditId = await writeAudit(req, {
      action: 'group.ai',
      targetType: 'group',
      targetId: String(id),
      targetLabel: before.groupName,
      reason: after.ai?.reason ?? null,
      details: { before: overrideSnapshot(before.ai), after: overrideSnapshot(after.ai) },
    });
    const [row] = await groupRows([after]);
    res.json({ data: { ...row, appliesWithinSeconds: SETTINGS_CACHE_SECONDS, auditId } });
  }),
);

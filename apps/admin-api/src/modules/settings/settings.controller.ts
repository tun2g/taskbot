import { Request, Response } from 'express';
import { aiSettingsSchema, restoreSchema } from 'src/modules/settings/settings.schemas';
import { getAiSettings, updateAiSettings } from 'src/modules/settings/settings.service';
import { parseOr400 } from 'src/shared/http';

// GET /settings/ai
export async function getAi(_req: Request, res: Response) {
  res.json({ data: await getAiSettings() });
}

// PUT /settings/ai — replaces the AI settings.
export async function putAi(req: Request, res: Response) {
  const input = parseOr400(aiSettingsSchema, req.body);
  const { restoredFrom } = restoreSchema.safeParse(req.body).data ?? {};
  res.json({ data: await updateAiSettings(req, input, restoredFrom) });
}

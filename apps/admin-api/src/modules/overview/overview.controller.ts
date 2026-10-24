import { Request, Response } from 'express';
import { loadOverview } from 'src/modules/overview/overview.service';
import { parseRange } from 'src/stats/range';

// GET /overview?range=7d|30d|90d
export async function getOverview(req: Request, res: Response) {
  res.json({ data: await loadOverview(parseRange(req.query.range)) });
}

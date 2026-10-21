import { getStatusCategory, statusesInCategory, TaskStatusCategory } from '@tbot/shared';
import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { sendError } from 'src/api/http-error';
import { AuthenticatedRequest } from 'src/api/middlewares/auth.middleware';
import { overdueCutoff, resolveGroupTimezone } from 'src/api/timezone';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { groupMemberService } from 'src/database/services/group-member.service';

type StatusCounts = Record<TaskStatusCategory, number>;

function toPlain<T>(doc: T): T {
  const maybe = doc as unknown as { toObject?: () => T };
  return typeof maybe?.toObject === 'function' ? maybe.toObject() : doc;
}

export class GroupController {
  /** GET /api/groups → IGroupSummary[] for the caller's groups. */
  async listGroups(req: Request, res: Response) {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?._id as mongoose.Types.ObjectId | undefined;
    if (!userId) {
      sendError(res, 401, 'Please sign in to continue.');
      return;
    }

    const groupIds = await groupMemberService.getUserGroups(userId);
    if (groupIds.length === 0) {
      res.json({ data: [] });
      return;
    }

    const [groups, statusRows, mineRows] = await Promise.all([
      Group.find({ _id: { $in: groupIds } }),
      Task.aggregate<{ _id: { groupId: mongoose.Types.ObjectId; status: string }; count: number }>([
        { $match: { groupId: { $in: groupIds } } },
        { $group: { _id: { groupId: '$groupId', status: '$status' }, count: { $sum: 1 } } },
      ]),
      Task.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        {
          $match: {
            groupId: { $in: groupIds },
            assigneeId: userId,
            status: { $nin: statusesInCategory(TaskStatusCategory.DONE) },
          },
        },
        { $group: { _id: '$groupId', count: { $sum: 1 } } },
      ]),
    ]);

    // Overdue = open with a due day before today, where "today" is each group's own local date.
    const openStatuses = { $nin: statusesInCategory(TaskStatusCategory.DONE) };
    const overdue = new Map<string, number>(
      await Promise.all(
        groups.map(
          async (group) =>
            [
              String(group._id),
              await Task.countDocuments({
                groupId: group._id,
                status: openStatuses,
                dueDate: { $ne: null, $lt: overdueCutoff(resolveGroupTimezone(group.timezone)) },
              }),
            ] as [string, number],
        ),
      ),
    );

    const counts = new Map<string, StatusCounts>();
    for (const row of statusRows || []) {
      const key = String(row._id.groupId);
      const entry = counts.get(key) ?? { todo: 0, in_progress: 0, done: 0 };
      // Summary counts are category totals (To do / In progress / Done)
      entry[getStatusCategory(row._id.status)] += row.count;
      counts.set(key, entry);
    }
    const mine = new Map<string, number>((mineRows || []).map((row) => [String(row._id), row.count]));

    const data = groups.map((group) => {
      const plain = toPlain(group);
      const key = String(group._id);
      return {
        ...plain,
        counts: counts.get(key) ?? { todo: 0, in_progress: 0, done: 0 },
        mine: mine.get(key) ?? 0,
        overdue: overdue.get(key) ?? 0,
      };
    });

    res.json({ data });
  }

  /** GET /api/groups/:groupId (requireGroupMember sets req.group). */
  async getGroup(req: Request, res: Response) {
    res.json({ data: (req as AuthenticatedRequest).group });
  }

  /** GET /api/groups/:groupId/members (requireGroupMember). */
  async getMembers(req: Request, res: Response) {
    const groupId = req.params.groupId as string;
    const members = await groupMemberService.getMembers(new mongoose.Types.ObjectId(groupId));
    res.json({ data: members });
  }
}

export const groupController = new GroupController();

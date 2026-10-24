import { GroupStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { Group, IGroup } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';

export class GroupService {
  async findOrCreateGroup(telegramGroupId: number, groupName: string): Promise<IGroup | null> {
    try {
      const group = await Group.findOneAndUpdate(
        { telegramGroupId },
        {
          $set: {
            groupName,
          },
          $setOnInsert: {
            telegramGroupId,
            timezone: 'UTC',
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        }
      );

      return group;
    } catch (error) {
      logger.error(`[GroupService] Error in findOrCreateGroup: ${error}`);
      return null;
    }
  }

  /** Groups that get service (approved and not suspended / left). */
  async getAllActiveGroups(): Promise<IGroup[]> {
    try {
      return await Group.find({ status: GroupStatus.ACTIVE });
    } catch (error) {
      logger.error(`Error getting all active groups: ${error}`);
      return [];
    }
  }

  async findGroupById(groupId: mongoose.Types.ObjectId): Promise<IGroup | null> {
    try {
      return await Group.findById(groupId);
    } catch (error) {
      logger.error(`[GroupService] Error in findGroupById: ${error}`);
      return null;
    }
  }

  async findGroupByTelegramId(telegramGroupId: number): Promise<IGroup | null> {
    try {
      return await Group.findOne({ telegramGroupId });
    } catch (error) {
      logger.error(`[GroupService] Error in findGroupByTelegramId: ${error}`);
      return null;
    }
  }

  async incrementTaskCounter(groupId: mongoose.Types.ObjectId): Promise<number> {
    const group = await Group.findOneAndUpdate(
      { _id: groupId },
      { $inc: { taskCounter: 1 } },
      { new: true, runValidators: true }
    );

    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }

    return group.taskCounter;
  }
}

export const groupService = new GroupService();

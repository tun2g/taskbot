import type { AiChatResponse } from '@tbot/shared';
import { groupTimezone, todayIn } from 'src/bot/task-card.renderer';
import { IUser } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import { decidePreview } from 'src/shared/services/ai-command/subtask-preview';
import { webSubtasksResponse } from 'src/shared/services/ai-command/subtasks.render';
import { populateResponse, rememberAppBatchPost } from 'src/shared/services/ai-command/web-chat';
import { taskSyncService } from 'src/shared/services/task-sync.service';

// POST /api/ai/previews/:previewId/(accept|cancel) — the web chat's "Add all" / "Cancel" under an AI-proposed
// breakdown. Accepting creates the subtasks like the chat would have, with ONE "(via app)" group post.

export const PREVIEW_EXPIRED_MESSAGE = 'These suggestions expired. Ask again to get new ones.';
export const PREVIEW_FORBIDDEN_MESSAGE = 'Only the person who asked can add or cancel these suggestions.';
export const PREVIEW_BUSY_MESSAGE = 'These suggestions are already being added.';

export type WebPreviewResult =
  | { status: 'ok'; data: AiChatResponse | { cancelled: true } }
  | { status: 'expired' | 'forbidden' | 'busy'; message: string };

export async function decidePreviewFromApp(
  user: IUser,
  previewId: string,
  decision: 'add' | 'cancel',
): Promise<WebPreviewResult> {
  const result = await decidePreview(previewId, decision, { userId: String(user._id) }, 'web');
  switch (result.status) {
    case 'expired':
      return { status: 'expired', message: PREVIEW_EXPIRED_MESSAGE };
    case 'forbidden':
      return { status: 'forbidden', message: PREVIEW_FORBIDDEN_MESSAGE };
    case 'busy':
      return { status: 'busy', message: PREVIEW_BUSY_MESSAGE };
    case 'cancelled':
      return { status: 'ok', data: { cancelled: true } };
    case 'added': {
      const { outcome } = result;
      const group = await groupService.findGroupById(outcome.parent.groupId);
      if (group && outcome.batchId && outcome.created.length) {
        const post = await taskSyncService.postCreatedFromApp(group, user, outcome.created);
        if (post) await rememberAppBatchPost(outcome.batchId, post);
      }
      const data = webSubtasksResponse(outcome, result.request, todayIn(groupTimezone(group)));
      await populateResponse(data);
      return { status: 'ok', data };
    }
  }
}

import { botMessageHandler } from 'src/bot/bot-message-handler';
import { aiCommand } from 'src/bot/commands/ai';
import { doneCommand } from 'src/bot/commands/done';
import { helpCommand } from 'src/bot/commands/help';
import { handleMcpCallback, MCP_CALLBACK_PREFIX } from 'src/bot/commands/mcp/mcp-callback.handler';
import { mcpCommand } from 'src/bot/commands/mcp/mcp.command';
import { handleMembersCallback, MEMBERS_CALLBACK_PREFIX, membersCommand } from 'src/bot/commands/members';
import { setTopicCommand } from 'src/bot/commands/settopic';
import { startCommand } from 'src/bot/commands/start';
import { subCommand } from 'src/bot/commands/sub';
import { taskCommand } from 'src/bot/commands/task';
import { tasksCommand } from 'src/bot/commands/tasks';
import { BotContext } from 'src/bot/interface/context';
import { handleBatchCallback } from 'src/bot/ai-batch-callback.handler';
import { CREATE_FROM_REPLY_PREFIX, handleCreateFromReplyCallback } from 'src/bot/create-from-reply';
import { handleGroupApprovalCallback } from 'src/bot/group-approval.handler';
import { handleHelpCallback } from 'src/bot/help-callback.handler';
import { handleTaskCallback } from 'src/bot/task-callback';
import { authMiddleware } from 'src/bot/middlewares/auth.middleware';
import { groupGateMiddleware } from 'src/bot/middlewares/group-gate.middleware';
import { groupLifecycleMiddleware } from 'src/bot/middlewares/group-lifecycle.middleware';
import { loggerMiddleware } from 'src/bot/middlewares/logger.middleware';
import { messageBufferMiddleware } from 'src/bot/middlewares/message-buffer.middleware';
import { topicTrackerMiddleware } from 'src/bot/middlewares/topic-tracker.middleware';
import { trackCommands, usageMiddleware } from 'src/bot/middlewares/usage.middleware';
import { mentionCheckMiddleware } from 'src/bot/middlewares/mention-check.middleware';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { GROUP_APPROVAL_PREFIX } from 'src/shared/services/group-lifecycle.service';
import {
  handleSubtaskPreviewCallback,
  isSubtaskPreviewCallback,
} from 'src/shared/services/ai-command/subtask-preview.telegram';
import { Telegraf } from 'telegraf';

const bot = new Telegraf<BotContext>(configService.botToken);

// Usage stats + request context for everything below (AI cost attribution, rate-limit events).
bot.use(usageMiddleware);
bot.use(loggerMiddleware);
// Bot added / removed, supergroup upgrades and first contact: the group record is current before anything reads it.
bot.use(groupLifecycleMiddleware);
// Membership + message buffer run on every group update (before the mention filter),
// so everyone who talks in the group can be assigned and their messages can become tasks.
// Membership is recorded for pending groups too, so the owner sees who is asking.
bot.use(authMiddleware);
// Only approved (ACTIVE) groups get past here; nothing of a pending group's chat is buffered.
bot.use(groupGateMiddleware);
bot.use(topicTrackerMiddleware);
bot.use(messageBufferMiddleware);
bot.use(mentionCheckMiddleware);

bot.start(async (ctx) => {
  // Deep links from /help and group /mcp ("/start mcp", "/start mcp_<groupId>") issue MCP tokens.
  if (await mcpCommand.handleStartPayload(ctx)) return;
  await startCommand.onStart(ctx);
});

const publicCommands: Map<string, (ctx: BotContext) => void> = new Map<string, (ctx: BotContext) => void>([
  ...startCommand.register(),
  ...helpCommand.register(),
  ...taskCommand.register(),
  ...tasksCommand.register(),
  ...doneCommand.register(),
  ...subCommand.register(),
  ...aiCommand.register(),
  ...setTopicCommand.register(),
  ...membersCommand.register(),
  ...mcpCommand.register(),
]);

trackCommands(publicCommands.keys());

Array.from(publicCommands).forEach(([command, callback]) => {
  bot.command(command, callback);
});

// Handle inline button presses
bot.on('callback_query', async (ctx: BotContext) => {
  const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
  if (data?.startsWith(GROUP_APPROVAL_PREFIX)) {
    await handleGroupApprovalCallback(ctx);
    return;
  }
  if (isSubtaskPreviewCallback(data)) {
    await handleSubtaskPreviewCallback(ctx);
    return;
  }
  if (data?.startsWith('batch:')) {
    await handleBatchCallback(ctx);
    return;
  }
  if (data?.startsWith(CREATE_FROM_REPLY_PREFIX)) {
    await handleCreateFromReplyCallback(ctx);
    return;
  }
  if (data?.startsWith(MCP_CALLBACK_PREFIX)) {
    await handleMcpCallback(ctx);
    return;
  }
  if (data?.startsWith(MEMBERS_CALLBACK_PREFIX)) {
    await handleMembersCallback(ctx);
    return;
  }
  if (data?.startsWith('help:')) {
    await handleHelpCallback(ctx);
    return;
  }
  await handleTaskCallback(ctx);
});

bot.on('message', async (ctx: BotContext) => {
  await botMessageHandler.process(ctx);
});

bot.catch((error, _ctx) => {
  logger.error(error);
});

export { bot };


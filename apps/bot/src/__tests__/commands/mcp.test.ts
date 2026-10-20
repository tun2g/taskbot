import mongoose from 'mongoose';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { renderHelpPage } from 'src/bot/commands/help';
import { handleMcpCallback } from 'src/bot/commands/mcp/mcp-callback.handler';
import { McpCommand, SENT_TO_DM_TEXT, START_DM_FIRST_TEXT } from 'src/bot/commands/mcp/mcp.command';
import { MCP_NOT_CONFIGURED_TEXT } from 'src/bot/commands/mcp/setup-message';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { apiTokenService, TooManyTokensError } from 'src/database/services/api-token.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';

jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/database/services/group.service', () => ({
  groupService: { findOrCreateGroup: jest.fn(), findGroupByTelegramId: jest.fn() },
}));
jest.mock('src/database/services/group-member.service', () => ({ groupMemberService: { getUserGroups: jest.fn() } }));
jest.mock('src/database/services/user.service', () => ({ userService: { findOrCreateUser: jest.fn() } }));
jest.mock('src/database/services/api-token.service', () => ({
  ...jest.requireActual('src/database/services/api-token.service'),
  apiTokenService: { create: jest.fn(), revoke: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 111, username: 'me' } as any;
const alpha = { _id: oid(), telegramGroupId: -1001, groupName: 'Team Alpha' } as any;
const beta = { _id: oid(), telegramGroupId: -1002, groupName: 'A very long group name for the product team' } as any;
const SECRET = 'tbot_' + 'x'.repeat(40);
const URL = 'https://bot.example.com/mcp';

function makeCtx(chat: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    chat,
    from: { id: 111 },
    message: { text: '/mcp' },
    reply: jest.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: jest.fn().mockResolvedValue(true),
    answerCbQuery: jest.fn().mockResolvedValue(true),
    telegram: { sendMessage: jest.fn().mockResolvedValue({ message_id: 2 }) },
    ...extra,
  } as any;
}
const dm = (extra: Record<string, unknown> = {}) => makeCtx({ id: 111, type: 'private' }, extra);
const inGroup = () => makeCtx({ id: -1001, type: 'supergroup', title: 'Team Alpha' });
const buttons = (extra: any) => (extra?.reply_markup?.inline_keyboard ?? []).flat();

beforeEach(() => {
  jest.clearAllMocks();
  configService.mcpPublicUrlOverride = URL;
  configService.botUsername = 'tbot_dev';
  configService.webappUrl = 'https://app.example.com';
  (userService.findOrCreateUser as jest.Mock).mockResolvedValue(me);
  (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([alpha._id, beta._id]);
  (Group.find as jest.Mock).mockReturnValue({ sort: jest.fn().mockResolvedValue([alpha, beta]) });
  (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(alpha);
  (checkGroupAccess as jest.Mock).mockImplementation(async (id: string) =>
    [alpha, beta].some((g) => String(g._id) === id)
      ? { ok: true, group: [alpha, beta].find((g) => String(g._id) === id) }
      : { ok: false },
  );
  (apiTokenService.create as jest.Mock).mockResolvedValue({ token: { _id: oid() }, secret: SECRET });
});

afterAll(() => {
  configService.mcpPublicUrlOverride = '';
  configService.webappUrl = 'http://localhost:5173';
});

describe('/mcp', () => {
  it('not configured → admin-facing message, no token', async () => {
    configService.mcpPublicUrlOverride = '';
    configService.webhookUrl = '';
    const ctx = dm();
    await new McpCommand().onMcp(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(MCP_NOT_CONFIGURED_TEXT, { parse_mode: 'HTML' });
    expect(MCP_NOT_CONFIGURED_TEXT).toContain('MCP_PUBLIC_URL');
    expect(apiTokenService.create).not.toHaveBeenCalled();
  });

  it('DM → group picker: groups two per row, then "All my groups"; no token yet', async () => {
    const ctx = dm();
    await new McpCommand().onMcp(ctx);
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain('Which group should this token work for?');
    const kb = extra.reply_markup.inline_keyboard;
    expect(kb[0].map((b: any) => b.callback_data)).toEqual([`mcp:new:${alpha._id}`, `mcp:new:${beta._id}`]);
    expect(kb[0][1].text.length).toBeLessThanOrEqual(28);
    expect(kb[1]).toEqual([{ text: '🌐 All my groups', callback_data: 'mcp:new:all' }]);
    expect(apiTokenService.create).not.toHaveBeenCalled();
  });

  it('DM with no groups → explains how to start', async () => {
    (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([]);
    const ctx = dm();
    await new McpCommand().onMcp(ctx);
    expect(ctx.reply.mock.calls[0][0]).toContain("You're not in a group with me yet");
  });

  it('group → token scoped to that group, sent by DM; the group only gets a short note', async () => {
    const ctx = inGroup();
    await new McpCommand().onMcp(ctx);
    expect(apiTokenService.create).toHaveBeenCalledWith(
      me._id,
      expect.stringMatching(/^Telegram \/mcp \d{4}-\d{2}-\d{2}$/),
      alpha._id,
    );
    const [chatId, text] = ctx.telegram.sendMessage.mock.calls[0];
    expect(chatId).toBe(111);
    expect(text).toContain('Token for</b> <b>Team Alpha</b>');
    expect(text).toContain(SECRET);
    expect(ctx.reply).toHaveBeenCalledWith(SENT_TO_DM_TEXT, expect.anything());
    expect(JSON.stringify(ctx.reply.mock.calls)).not.toContain(SECRET);
  });

  it('group, but the bot cannot DM the user → token revoked, deep link that issues it in DM', async () => {
    const tokenId = oid();
    (apiTokenService.create as jest.Mock).mockResolvedValue({ token: { _id: tokenId }, secret: SECRET });
    const ctx = inGroup();
    ctx.telegram.sendMessage.mockRejectedValue(
      new Error("403: Forbidden: bot can't initiate conversation with a user"),
    );
    await new McpCommand().onMcp(ctx);
    expect(apiTokenService.revoke).toHaveBeenCalledWith(me._id, String(tokenId));
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toBe(START_DM_FIRST_TEXT);
    expect(buttons(extra)[0].url).toBe(`https://t.me/tbot_dev?start=mcp_${alpha._id}`);
    expect(JSON.stringify(ctx.reply.mock.calls)).not.toContain(SECRET);
  });

  it('/start mcp_<groupId> in DM issues the group token', async () => {
    const ctx = dm({ message: { text: `/start mcp_${alpha._id}` } });
    expect(await new McpCommand().handleStartPayload(ctx)).toBe(true);
    expect(apiTokenService.create).toHaveBeenCalledWith(me._id, expect.any(String), alpha._id);
    expect(ctx.reply.mock.calls[0][0]).toContain(SECRET);
  });

  it('/start mcp opens the picker; other payloads fall through to /start', async () => {
    const picker = dm({ message: { text: '/start mcp' } });
    expect(await new McpCommand().handleStartPayload(picker)).toBe(true);
    expect(picker.reply.mock.calls[0][0]).toContain('Which group');
    expect(await new McpCommand().handleStartPayload(dm({ message: { text: '/start g1_t2' } }))).toBe(false);
  });
});

describe('group picker callback', () => {
  const tap = async (data: string) => {
    const ctx = dm({ callbackQuery: { data } });
    await handleMcpCallback(ctx);
    return ctx;
  };

  it('a group → issues a scoped token and turns the picker into the setup message', async () => {
    const ctx = await tap(`mcp:new:${alpha._id}`);
    expect(apiTokenService.create).toHaveBeenCalledWith(me._id, expect.any(String), alpha._id);
    const [text, extra] = ctx.editMessageText.mock.calls[0];
    expect(extra.parse_mode).toBe('HTML');
    expect(text).toContain('🔑 <b>Token for</b> <b>Team Alpha</b>');
    expect(text).toContain(`<code>${SECRET}</code>`);
    expect(text).toContain(
      `claude mcp add --transport http taskbot ${URL} --header &quot;Authorization: Bearer ${SECRET}&quot;`.replace(
        /&quot;/g,
        '"',
      ),
    );
    expect(text).toContain('~/.cursor/mcp.json');
    expect(text).toContain('&quot;mcpServers&quot;'.replace(/&quot;/g, '"'));
    expect(text).toContain('⚠️ <b>Shown once — treat it like a password.</b>');
    expect(text).toContain("Next: in Claude Code run <code>/mcp</code> to check it's connected.");
    expect(buttons(extra)).toEqual([
      { text: '🔑 Manage tokens', web_app: { url: 'https://app.example.com/settings/tokens' } },
      { text: '📖 How it works', callback_data: 'mcp:help' },
    ]);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('🔑 Token created');
  });

  it('"All my groups" → an unscoped token', async () => {
    const ctx = await tap('mcp:new:all');
    expect(apiTokenService.create).toHaveBeenCalledWith(me._id, expect.any(String), null);
    expect(ctx.editMessageText.mock.calls[0][0]).toContain('<b>all your groups</b>');
  });

  it('a group the user left → no token', async () => {
    const ctx = await tap(`mcp:new:${oid()}`);
    expect(apiTokenService.create).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("You're not a member of that group anymore.");
  });

  it('at the token limit → tells the user to revoke one', async () => {
    (apiTokenService.create as jest.Mock).mockRejectedValue(new TooManyTokensError());
    const ctx = await tap('mcp:new:all');
    expect(ctx.editMessageText.mock.calls[0][0]).toContain('already have 10 active tokens');
  });

  it('"📖 How it works" sends a NEW message (the token stays visible)', async () => {
    const ctx = await tap('mcp:help');
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toContain('🤖 *AI tools (MCP)*');
  });
});

describe('/help → AI tools (MCP)', () => {
  it('3 steps, a token deep link, the tokens page and « Back (≤3 buttons per row)', () => {
    const page = renderHelpPage('mcp', { chatType: 'private' });
    expect(page.text).toContain('1. DM me /mcp → get a token');
    expect(page.text).toContain('2. Paste the command into Claude Code');
    expect(page.text).toContain('3. Ask:');
    expect(page.text.split('\n').length).toBeLessThanOrEqual(16);
    expect(page.keyboard.every((row) => row.length <= 3)).toBe(true);
    const flat = page.keyboard.flat() as any[];
    expect(flat[0]).toEqual({ text: '🔑 Get a token', url: 'https://t.me/tbot_dev?start=mcp' });
    expect(flat[1]).toEqual({ text: '⚙️ Tokens', web_app: { url: 'https://app.example.com/settings/tokens' } });
    expect(flat[2].callback_data).toBe('help:home');
  });

  it('in a group the tokens page is a url button (web_app is DM-only)', () => {
    const flat = renderHelpPage('mcp', { chatType: 'supergroup' }).keyboard.flat() as any[];
    expect(flat[1]).toEqual({ text: '⚙️ Tokens', url: 'https://app.example.com/settings/tokens' });
  });
});

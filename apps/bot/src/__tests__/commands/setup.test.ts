jest.mock('src/shared/services/telegram-api.service', () => ({
  telegramApiService: { setMyCommands: jest.fn().mockResolvedValue(undefined), setChatMenuButton: jest.fn().mockResolvedValue(undefined) },
}));

import { setUpBotCommand } from 'src/bot/commands/setup';
import { telegramApiService } from 'src/shared/services/telegram-api.service';

describe('SetUpBotCommand', () => {
  it('writes the same command list to the default and every broad scope, so no stale scope hides it', async () => {
    await setUpBotCommand.process();
    const calls = (telegramApiService.setMyCommands as jest.Mock).mock.calls;
    expect(calls.map(([, scope]) => scope?.type ?? 'default')).toEqual([
      'default',
      'all_private_chats',
      'all_group_chats',
      'all_chat_administrators',
    ]);
    const lists = calls.map(([commands]) => commands);
    for (const list of lists) expect(list).toEqual(lists[0]);
    expect(lists[0].map((c: { command: string }) => c.command)).toContain('new');
  });
});

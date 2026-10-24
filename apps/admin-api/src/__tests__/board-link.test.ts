import axios from 'axios';

jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));

const post = axios.post as jest.Mock;

/** A fresh copy of the module each time: botProfile caches getMe for an hour. */
function load(): typeof import('src/shared/telegram') {
  let mod: typeof import('src/shared/telegram') | undefined;
  jest.isolateModules(() => {
    mod = require('src/shared/telegram');
  });
  return mod!;
}

function getMe(result: Record<string, unknown>) {
  post.mockResolvedValue({ status: 200, data: { ok: true, result: { id: 1, first_name: 'TaskBot', ...result } } });
}

afterEach(() => {
  delete process.env.WEBAPP_URL;
});

describe('boardButton (the approval message’s [Open board], same link as the bot builds)', () => {
  it('a bot with a Main Mini App: t.me/<bot>?startapp=<groupId>', async () => {
    getMe({ username: 'taskbot', has_main_web_app: true });
    expect(await load().boardButton('g1')).toEqual({ text: '📋 Open board', url: 'https://t.me/taskbot?startapp=g1' });
  });

  it('no Main Mini App: the https WEBAPP_URL board', async () => {
    getMe({ username: 'taskbot' });
    process.env.WEBAPP_URL = 'https://taskbot.example.com/';
    expect(await load().boardButton('g1')).toEqual({ text: '📋 Open board', url: 'https://taskbot.example.com/g1/tasks' });
  });

  it('nothing usable (no Main Mini App, WEBAPP_URL unset or not https): no button', async () => {
    getMe({ username: 'taskbot' });
    const mod = load();
    expect(await mod.boardButton('g1')).toBeNull();
    process.env.WEBAPP_URL = 'http://localhost:5173';
    expect(await mod.boardButton('g1')).toBeNull();
  });

  it('getMe failing still lets WEBAPP_URL work, and is not cached', async () => {
    post.mockResolvedValueOnce({ status: 500, data: { ok: false, description: 'Internal' } });
    process.env.WEBAPP_URL = 'https://taskbot.example.com';
    const mod = load();
    expect(await mod.boardButton('g1')).toEqual({ text: '📋 Open board', url: 'https://taskbot.example.com/g1/tasks' });
    getMe({ username: 'taskbot', has_main_web_app: true });
    expect((await mod.boardButton('g1'))?.url).toBe('https://t.me/taskbot?startapp=g1');
  });
});

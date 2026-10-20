import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import express from 'express';
import { AddressInfo } from 'net';
import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { apiTokenService } from 'src/database/services/api-token.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { mcpRouter } from 'src/mcp/mcp.router';
import { buildMcpServer } from 'src/mcp/server';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { alpha, ctx, me, oid } from './mcp-test-helpers';

jest.mock('src/bot', () => ({ bot: { telegram: {} } }));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn(), getUserGroups: jest.fn(), isMember: jest.fn() },
}));
jest.mock('src/database/services/api-token.service', () => ({
  ...jest.requireActual('src/database/services/api-token.service'),
  apiTokenService: { authenticate: jest.fn(), touch: jest.fn() },
}));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const EXPECTED_TOOLS = [
  'ask_taskbot',
  'list_groups',
  'list_members',
  'list_tasks',
  'get_task',
  'create_tasks',
  'update_task',
  'delete_task',
  'undo_last',
  'list_epics',
  'create_epic',
  'update_epic',
];

beforeEach(() => {
  jest.clearAllMocks();
  (checkGroupAccess as jest.Mock).mockResolvedValue({ ok: false, status: 403, message: 'x' });
  (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me]);
  (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({
    allowed: true,
    remaining: 1,
    retryAfterSeconds: 0,
  });
});

async function connect(context = ctx()) {
  const server = buildMcpServer(context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'claude-code', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

describe('MCP server (SDK, in memory)', () => {
  it('is "taskbot", tells the model how to work, and lists every tool with annotations + JSON schemas', async () => {
    const { client } = await connect();
    expect(client.getServerVersion()?.name).toBe('taskbot');
    const instructions = client.getInstructions() ?? '';
    expect(instructions).toContain('Call list_groups first');
    expect(instructions).toContain('Prefer ask_taskbot');
    expect(instructions).toContain('#12');

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.list_tasks.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.delete_task.annotations).toMatchObject({ destructiveHint: true });
    expect(byName.update_task.annotations).toMatchObject({ idempotentHint: true, readOnlyHint: false });
    expect(Object.keys((byName.create_tasks.inputSchema as any).properties)).toEqual(['group', 'tasks']);
    expect((byName.list_tasks.inputSchema as any).properties.limit.maximum).toBe(50);
  });

  it('a scoped connection names its group in the instructions', async () => {
    const { client } = await connect(ctx({ scopeGroup: alpha }));
    expect(client.getInstructions()).toContain('scoped to the group "Team Alpha"');
  });

  it('tool errors come back as isError with an actionable text', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'list_members', arguments: { group: String(oid()) } });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toContain('list_groups');
  });

  it('successful calls return text + structuredContent', async () => {
    (checkGroupAccess as jest.Mock).mockResolvedValue({ ok: true, group: alpha });
    const { client } = await connect();
    const result = await client.callTool({ name: 'list_members', arguments: { group: String(alpha._id) } });
    expect(result.isError).toBeFalsy();
    expect((result.content as any)[0].text).toContain('1 member in Team Alpha');
    expect((result.structuredContent as any).members[0]).toMatchObject({ name: '@me', isMe: true });
  });
});

describe('POST /mcp over HTTP (stateless)', () => {
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    const app = express();
    app.use('/mcp', mcpRouter);
    await new Promise<void>((resolve) => {
      const server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
        close = () => server.close();
        resolve();
      });
    });
  });
  afterAll(() => close());

  const post = (body: unknown, auth = 'Bearer tbot_' + 'a'.repeat(40)) =>
    fetch(base, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: auth,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('answers initialize and tools/list for a valid token', async () => {
    (apiTokenService.authenticate as jest.Mock).mockResolvedValue({
      ok: true,
      token: { _id: oid(), groupId: null },
      user: me,
    });
    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-code', version: '2.0.0' },
      },
    });
    expect(init.status).toBe(200);
    const initBody: any = await init.json();
    expect(initBody.result.serverInfo.name).toBe('taskbot');

    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listBody: any = await list.json();
    expect(listBody.result.tools).toHaveLength(EXPECTED_TOOLS.length);
  });

  it('401 + WWW-Authenticate without a token', async () => {
    const res = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer realm="taskbot"/);
  });

  it('a JSON-RPC parse error for malformed JSON', async () => {
    const res = await post('{nope');
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe(-32700);
  });

  it('GET is 405 (no SSE stream in stateless mode)', async () => {
    (apiTokenService.authenticate as jest.Mock).mockResolvedValue({
      ok: true,
      token: { _id: oid(), groupId: null },
      user: me,
    });
    const res = await fetch(base, { headers: { Authorization: 'Bearer tbot_' + 'a'.repeat(40) } });
    expect(res.status).toBe(405);
  });
});

import { clientLabel, clientNameFromInitialize, resolveClientLabel } from 'src/mcp/client-label';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/shared/services/redis.service', () => ({ redisService: { get: jest.fn(), set: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

describe('client label', () => {
  it.each([
    ['claude-code', 'Claude Code'],
    ['Claude Code', 'Claude Code'],
    ['cursor-vscode', 'Cursor'],
    ['', 'MCP'],
    [undefined, 'MCP'],
    ['my<agent>*_bot', 'my agent bot'],
  ])('%s → %s', (name, label) => {
    expect(clientLabel(name as string | undefined)).toBe(label);
  });

  it('reads clientInfo.name from an initialize request (single or batch)', () => {
    const init = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'claude-code', version: '2' } },
    };
    expect(clientNameFromInitialize(init)).toBe('claude-code');
    expect(clientNameFromInitialize([init])).toBe('claude-code');
    expect(clientNameFromInitialize({ method: 'tools/list' })).toBeNull();
  });

  it('remembers the name per token on initialize and reuses it later', async () => {
    const init = { method: 'initialize', params: { clientInfo: { name: 'cursor-vscode' } } };
    expect(await resolveClientLabel('t1', init)).toBe('Cursor');
    expect(redisService.set).toHaveBeenCalledWith('mcp_client:t1', 'cursor-vscode', { EX: expect.any(Number) });

    (redisService.get as jest.Mock).mockResolvedValue('cursor-vscode');
    expect(await resolveClientLabel('t1', { method: 'tools/call' })).toBe('Cursor');

    (redisService.get as jest.Mock).mockResolvedValue(null);
    expect(await resolveClientLabel('t2', { method: 'tools/call' })).toBe('MCP');
  });
});

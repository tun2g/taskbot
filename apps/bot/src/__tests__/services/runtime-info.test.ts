import { configService } from 'src/configs/configuration';
import { Setting } from 'src/database/models/setting.model';
import { publishRuntimeInfo, runtimeInfo } from 'src/shared/services/settings.service';

jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

describe('runtime info for the admin app', () => {
  const startedAt = new Date('2026-10-24T08:00:00.000Z');

  it('reports the effective provider, model and env daily limit', () => {
    const before = { ...configService.ai };
    Object.assign(configService.ai, { provider: 'openai', model: 'gpt-5-mini', dailyLimit: 300 });
    expect(runtimeInfo(startedAt)).toEqual({
      provider: 'openai',
      model: 'gpt-5-mini',
      envDailyCallLimit: 300,
      startedAt: '2026-10-24T08:00:00.000Z',
    });
    Object.assign(configService.ai, before);
  });

  it('upserts it under the `runtime` settings key, and never throws', async () => {
    const update = jest.spyOn(Setting, 'updateOne').mockResolvedValueOnce({} as never);
    await publishRuntimeInfo(startedAt);
    expect(update).toHaveBeenCalledWith(
      { key: 'runtime' },
      { $set: { value: runtimeInfo(startedAt) } },
      { upsert: true },
    );

    update.mockRejectedValueOnce(new Error('not connected'));
    await expect(publishRuntimeInfo(startedAt)).resolves.toBeUndefined();
  });
});

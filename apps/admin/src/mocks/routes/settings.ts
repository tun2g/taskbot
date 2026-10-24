/** AI settings: read, and save (or restore) with the same audit lines the API writes. */
import { aiSettingsChangeLines } from '@tbot/shared';

import { recordAudit, settings } from '../fixtures';
import type { Route } from '../http';

function save(body: Record<string, unknown>) {
  const before = { ...settings, defaults: undefined };
  const { restoredFrom, ...values } = body;
  Object.assign(settings, values, { defaults: settings.defaults, lastChangedAt: new Date().toISOString() });
  recordAudit({
    action: restoredFrom ? 'settings.ai.restore' : 'settings.ai.update',
    summary: restoredFrom ? 'Restored earlier AI settings' : 'Changed AI settings',
    targetType: 'settings',
    targetLabel: 'AI settings',
    details: { before, after: values, ...(restoredFrom ? { restoredFrom } : {}) },
    changes: aiSettingsChangeLines(before, values, settings.defaults.builtInPricing),
  });
  return { data: settings };
}

export const settingsRoutes: Route[] = [
  ['GET', /^\/settings\/ai$/, () => ({ data: settings })],
  ['PUT', /^\/settings\/ai$/, ({ body }) => save(body)],
];

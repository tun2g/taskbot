import { createFileRoute } from '@tanstack/react-router';

import { SettingsTokensPage } from '@/pages/settings-tokens/settings-tokens.page';

export interface TokensSearch {
  /** Preselect this group in "Works in" (links from a group's board). */
  group?: string;
}

export const Route = createFileRoute('/settings/tokens')({
  validateSearch: (search: Record<string, unknown>): TokensSearch => ({
    group: typeof search.group === 'string' && search.group ? search.group : undefined,
  }),
  component: SettingsTokensPage,
});

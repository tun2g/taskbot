import type { AdminMcpTokenRow } from '@tbot/shared';

import { TokenListBody } from '@/components/tokens/token-list-body';
import type { TokenList } from '@/components/tokens/use-token-list';
import { Card, CardHeader } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/input';

/** Every token that works right now (paginated, searchable), each with its own "Revoke". */
export function McpTokensCard({
  list,
  query,
  onQuery,
  onRevoke,
  onOpenOwner,
}: {
  list: TokenList;
  query: string;
  onQuery: (q: string) => void;
  onRevoke: (token: AdminMcpTokenRow) => void;
  onOpenOwner: (token: AdminMcpTokenRow) => void;
}) {
  return (
    <Card>
      <div id="tokens" className="scroll-mt-20" />
      <CardHeader
        title="Active tokens"
        subtitle="Every token that works right now, newest first. Revoke one to cut off that AI client — the owner’s other tokens keep working."
        action={<SearchInput value={query} onChange={onQuery} placeholder="Token, prefix or owner" className="w-full sm:w-64" />}
      />
      <TokenListBody
        list={list}
        mode="active"
        showOwner
        onRevoke={onRevoke}
        onOpenOwner={onOpenOwner}
        empty={
          query
            ? { title: `No active token matches “${query}”.`, body: 'Search looks at the token name, its first characters and the owner’s name.' }
            : { title: 'No active tokens.', body: 'People create tokens in the Mini App → Settings → AI tools.' }
        }
      />
    </Card>
  );
}

import { EmptyState } from '@/components/ui/states';

/** Why the list is empty, in the owner's terms (a filter, a search, or nobody yet). */
export function UsersEmpty({ hasTokens, activeIn, searched, query }: { hasTokens: boolean; activeIn: boolean; searched: boolean; query: string }) {
  if (hasTokens && !searched)
    return <EmptyState title="No one holds an active MCP token." body="People create tokens in the Mini App → Settings → AI tools. Remove the filter to see everyone." />;
  if (activeIn && !searched) return <EmptyState title="No one used the bot in this window." body="Remove the filter to see everyone." />;
  if (searched)
    return <EmptyState title={`No one matches “${query}”.`} body="Search looks at names and Telegram usernames. People appear here once they use the bot." />;
  return (
    <EmptyState
      title="No one has used the bot yet."
      body="People show up here after their first command, button tap or Mini App visit in an approved group."
    />
  );
}

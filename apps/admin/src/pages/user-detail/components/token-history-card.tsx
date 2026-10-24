import { TokenListBody } from '@/components/tokens/token-list-body';
import type { TokenList } from '@/components/tokens/use-token-list';
import { Card, CardHeader } from '@/components/ui/card';

/** Tokens that no longer work (revoked by you or the person, or expired), most recent first. */
export function TokenHistoryCard({ name, list }: { name: string; list: TokenList }) {
  return (
    <Card>
      <CardHeader title="Revoked & expired tokens" subtitle="Tokens that no longer work, most recently ended first — so you can tell which client lost access and when." />
      <TokenListBody list={list} mode="history" empty={{ title: `None of ${name}’s tokens have been revoked or have expired.` }} />
    </Card>
  );
}

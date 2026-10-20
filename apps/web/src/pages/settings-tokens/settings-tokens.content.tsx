import type { IGroupSummary } from '@tbot/shared';

import { Layout } from '@/components/layout/layout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorBox } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { MAX_API_TOKENS, type CreateApiTokenInput, type CreateApiTokenResponse, type IApiToken } from '@/api/tokens';

import { CreateTokenForm } from './components/create-token-form';
import { RevokeTokenDialog } from './components/revoke-token-dialog';
import { SetupSnippets } from './components/setup-snippets';
import { TokenRow } from './components/token-row';
import { TokenSecretDialog } from './components/token-secret-dialog';
import { TOKEN_PLACEHOLDER } from './snippets';

interface SettingsTokensContentProps {
  onBack: () => void;

  mcpUrl: string | undefined;
  mcpError: string | null;
  onRetryMcp: () => void;

  tokens: IApiToken[];
  tokensLoading: boolean;
  tokensError: string | null;
  onRetryTokens: () => void;
  isRetryingTokens: boolean;

  groups: IGroupSummary[];
  groupsLoading: boolean;
  preferredGroupId?: string;
  onCreate: (input: CreateApiTokenInput) => Promise<boolean>;
  isCreating: boolean;
  createError: string | null;
  /** The token just created — its secret is shown once, in a sheet. */
  created: CreateApiTokenResponse | null;
  onCreatedDone: () => void;

  revoking: IApiToken | null;
  isRevoking: boolean;
  onRevokeRequest: (token: IApiToken) => void;
  onRevokeConfirm: () => void;
  onRevokeCancel: () => void;
}

export function SettingsTokensContent(props: SettingsTokensContentProps) {
  const { tokens, tokensLoading, tokensError, mcpUrl, mcpError } = props;
  const atLimit = tokens.length >= MAX_API_TOKENS;
  const limitMessage = atLimit
    ? `You have ${MAX_API_TOKENS} tokens, the most allowed. Revoke one you no longer use to create a new one.`
    : null;

  return (
    <Layout title="AI tools (MCP)" onBack={props.onBack}>
      <div className="space-y-4 p-4">
        <p className="text-sm text-tg-hint">Let Claude Code, Cursor and other AI tools create and update your tasks.</p>

        <Card title="Set up" titleId="mcp-setup">
          <div className="p-4">
            {mcpUrl ? (
              <SetupSnippets url={mcpUrl} token={TOKEN_PLACEHOLDER} />
            ) : mcpError ? (
              <ErrorBox>
                Couldn't load the server address. {mcpError}{' '}
                <button type="button" className="font-semibold underline" onClick={props.onRetryMcp}>
                  Retry
                </button>
              </ErrorBox>
            ) : (
              <div className="space-y-3" aria-busy>
                <Skeleton className="h-10" />
                <Skeleton className="h-20" />
              </div>
            )}
            <p className="mt-3 text-xs text-tg-hint">
              Replace <code className="font-mono">{TOKEN_PLACEHOLDER}</code> with a token you create below.
            </p>
          </div>
        </Card>

        <Card title="Create token" titleId="create-token">
          <CreateTokenForm
            groups={props.groups}
            groupsLoading={props.groupsLoading}
            preferredGroupId={props.preferredGroupId}
            onCreate={props.onCreate}
            isCreating={props.isCreating}
            error={props.createError}
            limitMessage={limitMessage}
          />
        </Card>

        <Card
          title="Your tokens"
          titleId="token-list"
          actions={
            tokens.length > 0 && (
              <span className="text-xs text-tg-hint">
                {tokens.length} of {MAX_API_TOKENS}
              </span>
            )
          }
        >
          {tokensLoading ? (
            <div className="space-y-3 p-4" aria-busy>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : tokensError ? (
            <div className="p-4">
              <ErrorBox>{tokensError}</ErrorBox>
              <Button className="mt-3" onClick={props.onRetryTokens} loading={props.isRetryingTokens} loadingText="Retrying…">
                Retry
              </Button>
            </div>
          ) : tokens.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <div className="mb-2 text-3xl" aria-hidden>
                🔑
              </div>
              <p className="text-sm font-medium text-tg-text">No tokens yet</p>
              <p className="mt-1 text-sm text-tg-hint">Create one above, then paste it into Claude Code or Cursor.</p>
            </div>
          ) : (
            <ul className="divide-y divide-tg-separator">
              {tokens.map((token) => (
                <TokenRow key={token._id} token={token} onRevoke={props.onRevokeRequest} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {props.created && (
        <TokenSecretDialog
          name={props.created.token.name}
          scope={props.created.token.group?.title ?? null}
          secret={props.created.secret}
          mcpUrl={mcpUrl ?? (mcpError ? null : undefined)}
          onDone={props.onCreatedDone}
        />
      )}
      {props.revoking && (
        <RevokeTokenDialog
          token={props.revoking}
          isRevoking={props.isRevoking}
          onConfirm={props.onRevokeConfirm}
          onClose={props.onRevokeCancel}
        />
      )}
    </Layout>
  );
}

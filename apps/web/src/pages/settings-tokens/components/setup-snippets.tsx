import { useState } from 'react';

import { Segmented } from '@/components/ui/segmented';

import { claudeCodeCommand, claudeProjectConfig, cursorConfig, type McpClient, tokenEnvExport } from '../snippets';
import { CodeBlock } from './code-block';

const CLIENTS: { value: McpClient; label: string }[] = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'cursor', label: 'Cursor' },
];

interface SetupSnippetsProps {
  url: string;
  /** The real secret, or the `<your token>` placeholder. */
  token: string;
}

/** "Claude Code" | "Cursor" switch and the matching snippet. */
export function SetupSnippets({ url, token }: SetupSnippetsProps) {
  const [client, setClient] = useState<McpClient>('claude');
  return (
    <div className="space-y-3">
      <Segmented
        ariaLabel="AI tool"
        value={client}
        options={CLIENTS}
        onChange={setClient}
        className="w-full [&>button]:flex-1"
      />
      {client === 'claude' ? (
        <>
          <p className="text-sm text-tg-hint">Run this in your terminal:</p>
          <CodeBlock code={claudeCodeCommand(url, token)} label="Claude Code command" wrap />
          <details className="group rounded-lg border border-tg-separator">
            <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm font-medium text-tg-link [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="transition-transform group-open:rotate-90">
                ›
              </span>
              Per-project setup
            </summary>
            <div className="space-y-3 px-3 pb-3">
              <p className="text-sm text-tg-hint">
                Recommended: one token scoped to the group each repo works on. Put this in the repo's{' '}
                <code className="font-mono text-tg-text">.mcp.json</code> — it reads the token from your environment:
              </p>
              <CodeBlock code={claudeProjectConfig(url)} label="Project .mcp.json" />
              <p className="text-sm text-tg-hint">Then set the token in your shell (e.g. ~/.zshrc or the repo's .envrc):</p>
              <CodeBlock code={tokenEnvExport(token)} label="Token environment variable" wrap />
              <p className="text-xs font-medium text-tg-destructive">
                Never commit the real token — only the <code className="font-mono">${'{'}TBOT_TOKEN{'}'}</code> reference.
              </p>
            </div>
          </details>
        </>
      ) : (
        <>
          <p className="text-sm text-tg-hint">
            Add this to <code className="font-mono text-tg-text">~/.cursor/mcp.json</code> (or the project's{' '}
            <code className="font-mono text-tg-text">.cursor/mcp.json</code>):
          </p>
          <CodeBlock code={cursorConfig(url, token)} label="Cursor config" />
        </>
      )}
    </div>
  );
}

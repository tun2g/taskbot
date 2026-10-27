import { Bubble } from '@/components/chat';
import { Container, Eyebrow } from '@/components/ui';
import { LINKS } from '@/links';

export function Mcp() {
  return (
    <section id="mcp" className="border-y border-line bg-surface py-24">
      <Container className="grid grid-cols-1 items-center gap-14 [&>*]:min-w-0 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Eyebrow>For developers</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.1]">
            Your coding agent can update the board too
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-2">
            TaskBot ships a remote MCP server. Connect Claude Code or Cursor once, and your agent can list, create and
            update tasks and epics, then tell the team about it in the group.
          </p>
          <ul className="mt-6 space-y-3 text-[15.5px] text-ink-2">
            <li>
              <b className="text-ink">One command to connect.</b> Send{' '}
              <code className="font-mono text-[14px]">/mcp</code> to the bot in a private chat to get a token.
            </li>
            <li>
              <b className="text-ink">Scoped tokens.</b> One group or all of yours, managed and revoked from the Mini
              App.
            </li>
            <li>
              <b className="text-ink">Transparent.</b> Every agent change is labelled in the group, so nobody is
              surprised.
            </li>
          </ul>
          <a
            href={LINKS.mcpDocs}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-7 inline-flex items-center gap-1.5 font-semibold text-accent-text hover:underline"
          >
            Read the MCP guide <span aria-hidden="true">→</span>
          </a>
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl bg-code font-mono text-[13.5px] leading-relaxed text-code-text shadow-float">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3" aria-hidden="true">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#febc2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
              <span className="ml-3 text-[12px] text-code-dim">terminal</span>
            </div>
            <pre className="overflow-x-auto p-5 whitespace-pre-wrap break-all">
              <span className="text-code-dim">$ </span>claude mcp add --transport http taskbot \{'\n'}
              {'    '}https://taskbot.chamees.site/mcp \{'\n'}
              {'    '}--header <span className="text-code-accent">"Authorization: Bearer $TOKEN"</span>
              {'\n\n'}
              <span className="text-code-dim">&gt; </span>
              <span className="text-white">create a task to fix the login bug for @an, due Friday</span>
              {'\n'}
              <span className="text-[#7fcf86]">● taskbot.create_task</span>
              <span className="text-code-dim"> → #48 created in Acme Mobile Team</span>
              <span className="caret ml-0.5 inline-block h-4 w-2 translate-y-0.5 bg-code-text" aria-hidden="true" />
            </pre>
          </div>
          <div className="chat-wallpaper rounded-2xl border border-line p-3">
            <Bubble from="TaskBot" color={3} time="17:20">
              🆕 #48 Fix login bug · 👤 @an · 📅 Fri
              <p className="text-[12.5px] text-bubble-meta">by Minh (via Claude Code)</p>
            </Bubble>
          </div>
        </div>
      </Container>
    </section>
  );
}

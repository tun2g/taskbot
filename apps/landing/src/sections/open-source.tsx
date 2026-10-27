import { ButtonLink, Container, Eyebrow, GitHubIcon } from '@/components/ui';
import { LINKS } from '@/links';

const STACK = ['Telegraf', 'Express', 'MongoDB', 'Redis + Bull', 'React 19', 'Tailwind v4', 'TanStack', 'MCP SDK'];

export function OpenSource() {
  return (
    <section className="py-24">
      <Container>
        <div className="grid grid-cols-1 gap-10 rounded-3xl border border-line bg-surface p-8 sm:p-12 lg:grid-cols-2 lg:items-center">
          <div>
            <Eyebrow>Open source</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Run it yourself. Your chats, your server.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">
              TaskBot is MIT licensed. Bring your own bot token and AI provider, start MongoDB and Redis with Docker,
              and you have the whole thing: bot, board, MCP server and an owner dashboard for approving groups and
              watching AI cost.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {STACK.map((s) => (
                <span
                  key={s}
                  className="rounded-lg border border-line bg-bg px-2.5 py-1 text-[13.5px] font-medium text-ink-2"
                >
                  {s}
                </span>
              ))}
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={LINKS.github}>
                <GitHubIcon />
                View on GitHub
              </ButtonLink>
              <ButtonLink href={LINKS.selfHost} variant="secondary">
                Deployment guide
              </ButtonLink>
            </div>
          </div>
          <pre className="min-w-0 overflow-x-auto rounded-2xl bg-code p-6 font-mono text-[13.5px] leading-7 text-code-text">
            <span className="text-code-dim">$ </span>git clone https://github.com/tun2g/taskbot{'\n'}
            <span className="text-code-dim">$ </span>cd taskbot && pnpm install{'\n'}
            <span className="text-code-dim">$ </span>docker compose -f docker-compose.dev.yml up -d{'\n'}
            <span className="text-code-dim">$ </span>cp apps/bot/.env.example apps/bot/.env{'\n'}
            <span className="text-code-dim"># set BOT_TOKEN, then</span>
            {'\n'}
            <span className="text-code-dim">$ </span>pnpm dev{'\n'}
            <span className="text-[#7fcf86]">✓ bot on :3000 · Mini App on :5173</span>
          </pre>
        </div>
      </Container>
    </section>
  );
}

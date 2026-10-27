import { Container, GitHubIcon, Logo, TelegramIcon } from '@/components/ui';
import { LINKS } from '@/links';

export function FinalCta() {
  return (
    <section className="py-24">
      <Container>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a8fe0] to-[#1662a8] px-6 py-16 text-center text-white sm:px-12">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-balance sm:text-5xl sm:leading-[1.1]">
            Stop losing tasks in the scrollback
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-white/85">
            Add TaskBot to your group and send <code className="font-mono">/new</code> on the next thing someone asks
            for.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href={LINKS.addToGroup}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-[15px] font-semibold text-[#1662a8] transition-colors hover:bg-white/90"
            >
              <TelegramIcon />
              Add TaskBot to a group
            </a>
            <a
              href={LINKS.openBot}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center rounded-xl border border-white/40 px-5 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              Message the bot
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line py-10">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5 font-bold">
          <Logo className="size-7" />
          TaskBot
          <span className="font-normal text-ink-3">· MIT licensed</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-ink-2 sm:ml-auto" aria-label="Footer">
          <a href={LINKS.docs} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            Docs
          </a>
          <a href={LINKS.commands} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            Commands
          </a>
          <a href={LINKS.mcpDocs} target="_blank" rel="noopener noreferrer" className="hover:text-ink">
            MCP
          </a>
          <a
            href={LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-ink"
          >
            <GitHubIcon className="size-4" />
            GitHub
          </a>
        </nav>
      </Container>
    </footer>
  );
}

import { Bubble, ChatHeader, Cmd, Keyboard } from '@/components/chat';
import { ButtonLink, Container, GitHubIcon, TelegramIcon } from '@/components/ui';
import { LINKS } from '@/links';

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-gradient-to-b from-bg-tint to-bg"
        aria-hidden="true"
      />
      {/* Soft color blobs; they also give the glass header something to blur. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 left-[8%] size-[520px] rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -top-24 right-[6%] size-[440px] rounded-full bg-violet/15 blur-3xl" />
      </div>
      <Container className="grid grid-cols-1 items-center gap-14 [&>*]:min-w-0 pt-28 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-36 lg:pb-28">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-ink-2">
            <span className="size-1.5 rounded-full bg-good" />
            Open source · free to self-host
          </p>
          <h1 className="mt-6 text-[2.6rem] leading-[1.05] font-extrabold tracking-tight text-balance sm:text-[3.4rem] xl:text-6xl">
            Say it in the group.
            <br />
            <span className="text-accent-text">Track it on the board.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-ink-2 sm:text-xl">
            TaskBot lives in your Telegram group and turns “can you fix this by Friday?” into a real task, with an
            owner, a due date and a Kanban board, without anyone leaving the chat.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={LINKS.addToGroup}>
              <TelegramIcon />
              Add TaskBot to a group
            </ButtonLink>
            <ButtonLink href={LINKS.github} variant="secondary">
              <GitHubIcon />
              Star on GitHub
            </ButtonLink>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[15px] text-ink-3">
            {['No new account: Telegram is the login', 'English & Tiếng Việt', 'MIT licensed'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <HeroChat />
      </Container>
    </section>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="size-4 text-good" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroChat() {
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div className="overflow-hidden rounded-[28px] border border-line bg-surface shadow-float">
        <ChatHeader title="Acme Mobile Team" subtitle="6 members, TaskBot" />
        <div
          className="chat-wallpaper flex flex-col gap-2.5 px-3 pt-4 pb-9"
          role="img"
          aria-label="A Telegram group chat where a message is turned into a task card by TaskBot"
        >
          <Bubble from="Minh" color={2} time="10:41" delay={150}>
            iOS login crashes right after the last build 😩
          </Bubble>
          <Bubble from="Minh" color={2} time="10:41" delay={500}>
            @lan can you take it? We need it before Friday’s release
          </Bubble>
          <Bubble from="Lan" time="10:42" out delay={1000}>
            <span className="mb-1 block border-l-2 border-chat-link pl-2 text-[12.5px] opacity-80">
              Minh: iOS login crashes right after…
            </span>
            <Cmd>/new</Cmd>
          </Bubble>
          <div className="rise" style={{ animationDelay: '1700ms' }}>
            <Bubble from="TaskBot" color={3} time="10:42">
              <p className="font-semibold">🐞 #42 Fix iOS login crash after latest build</p>
              <p className="mt-1">📝 To do · 🔴 High</p>
              <p>👤 @lan · 📅 Fri, Oct 30</p>
              <p className="mt-1 text-[12.5px] text-bubble-meta">Created by Lan from Minh’s message</p>
            </Bubble>
            <Keyboard rows={[['▶️ Start', '👤 Assign', '⋯ More'], ['📋 Open board']]} />
          </div>
        </div>
      </div>

      <p
        className="rise absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13.5px] font-medium whitespace-nowrap shadow-float"
        style={{ animationDelay: '2400ms' }}
      >
        <span className="size-2 rounded-full bg-good" aria-hidden="true" />
        #42 is on the board, in sync with the chat
      </p>
    </div>
  );
}

import { Container, SectionHeading } from '@/components/ui';

const STEPS = [
  {
    n: '1',
    title: 'Add the bot to your group',
    body: 'Each Telegram group becomes its own workspace. Members are already there, so there is nobody to invite and no account to create.',
    code: '@taskbot',
  },
  {
    n: '2',
    title: 'Turn messages into tasks',
    body: 'Reply /new to a message, run /new all on a thread, or /new 10 on the last ten messages. AI picks out the title, type, owner and due date.',
    code: '/new Fix login on iOS @lan',
  },
  {
    n: '3',
    title: 'Work from the card or the board',
    body: 'Move status, assign and set priority from the card in the chat, or open the Mini App board. Both stay in sync.',
    code: '📋 Open board',
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-y border-line bg-surface py-24">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="From chat message to tracked task in one reply"
          lead="Decisions already happen in your group. TaskBot catches them before they scroll away."
        />
        <ol className="mt-16 grid gap-6 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="relative rounded-2xl border border-line bg-bg p-6">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-lg font-bold text-accent-text">
                {s.n}
              </span>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-[15.5px] leading-relaxed text-ink-2">{s.body}</p>
              <p className="mt-5 inline-block rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-[13.5px] text-ink-2">
                {s.code}
              </p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

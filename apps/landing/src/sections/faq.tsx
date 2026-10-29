import { Container, SectionHeading } from '@/components/ui';

const FAQ = [
  {
    q: 'Does everyone in the group need to sign up?',
    a: 'No. Telegram is the login. Anyone in the group can create and update tasks, and the Mini App knows who they are from Telegram.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. TaskBot is open source under the MIT license. You can use the hosted bot or run your own copy.',
  },
  {
    q: 'Do I need an AI key?',
    a: 'Only on your own server, and only for the AI features. Without one, /new still creates a basic task from your text. Gemini, OpenAI and any OpenAI-compatible endpoint (OpenRouter, Groq, Ollama, …) work.',
  },
  {
    q: 'Why is the bot “waiting for approval” in my group?',
    a: 'The person running a TaskBot server can require approval for new groups. On the hosted bot, the owner approves your group and TaskBot posts a “ready” message. Your own server can approve every group automatically.',
  },
  {
    q: 'Can it read the last few messages in a busy group?',
    a: 'Yes, /new 10 and /new all turn recent messages into tasks. The bot needs group privacy turned off in BotFather to see messages that are not commands; the hosted bot already has it.',
  },
  {
    q: 'Does it work with forum topics?',
    a: 'Yes. Task events go to a dedicated “Task events” topic, or one you choose with /settopic, so they don’t flood the conversation.',
  },
];

// FAQPage structured data, built from the same list so it never drifts from the visible answers.
const FAQ_JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  })),
}).replace(/</g, '\\u003c');

export function Faq() {
  return (
    <section id="faq" className="border-t border-line bg-surface py-24">
      <Container className="max-w-3xl">
        <SectionHeading eyebrow="FAQ" title="Questions teams ask first" />
        <div className="mt-12 divide-y divide-line border-y border-line">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex list-none items-center justify-between gap-4 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-3 transition-transform group-open:rotate-45"
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 pr-10 text-[15.5px] leading-relaxed text-ink-2">{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
    </section>
  );
}

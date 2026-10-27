import type { ReactNode } from 'react';

import { Container, SectionHeading } from '@/components/ui';

type Feature = { icon: ReactNode; tone: string; title: string; body: string; points: string[] };

const FEATURES: Feature[] = [
  {
    icon: '💬',
    tone: 'bg-accent-soft',
    title: 'Lives in the chat',
    body: 'Interactive task cards right where the conversation is.',
    points: [
      'Next status, assign, type and priority from the card',
      '/sub for subtasks, /list, /mytasks and /done',
      'Undo a task created by mistake for 10 minutes',
      'Forum topics: events go to their own topic',
    ],
  },
  {
    icon: '✨',
    tone: 'bg-violet-soft',
    title: 'An AI that knows your tasks',
    body: 'Ask or change anything in plain words, in English or Vietnamese.',
    points: [
      'Splits one message into several tasks',
      'Reassign, reprioritise, set due dates with /ai',
      'Groups tasks into epics, splits big ones up',
      'Gemini, OpenAI or any compatible endpoint',
    ],
  },
  {
    icon: '📋',
    tone: 'bg-good-soft',
    title: 'A real board in Telegram',
    body: 'A Mini App with Kanban and list views that opens inside the chat.',
    points: [
      'Drag cards between statuses',
      'Group by status or assignee, filter to “just mine”',
      'Task page with subtasks, source messages and history',
      'Also works in a normal browser',
    ],
  },
  {
    icon: '⏰',
    tone: 'bg-warn-soft',
    title: 'Nudges, not nagging',
    body: 'People hear about their work at the right time, in the right place.',
    points: [
      'DM when you are assigned or your task moves',
      'Reminder the day before a task is due',
      'Daily group digest at 9:00 group time',
      'Every job respects the group’s timezone',
    ],
  },
];

export function Features() {
  return (
    <section id="features" className="py-24">
      <Container>
        <SectionHeading
          eyebrow="Features"
          title="Everything a small team needs, nothing it has to learn"
          lead="If your team can send a Telegram message, it can use TaskBot."
        />
        <div className="mt-16 grid gap-5 md:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="rounded-2xl border border-line bg-surface p-7">
              <span className={`grid size-12 place-items-center rounded-xl text-2xl ${f.tone}`} aria-hidden="true">
                {f.icon}
              </span>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-1.5 text-[15.5px] text-ink-2">{f.body}</p>
              <ul className="mt-5 space-y-2.5">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-2.5 text-[15px] text-ink-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}

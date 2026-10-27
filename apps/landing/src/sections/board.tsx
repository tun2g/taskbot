import { Container, Eyebrow } from '@/components/ui';

type Card = { title: string; type: string; typeTone: string; who: string; id: number; due?: string };

const COLUMNS: { name: string; dot: string; cards: Card[] }[] = [
  {
    name: 'To do',
    dot: 'bg-ink-3',
    cards: [
      {
        id: 42,
        title: 'Fix iOS login crash after latest build',
        type: 'Bug',
        typeTone: 'bg-danger-soft text-danger',
        who: 'Lan',
        due: 'Fri',
      },
      {
        id: 45,
        title: 'Release notes for 2.4',
        type: 'Task',
        typeTone: 'bg-accent-soft text-accent-text',
        who: 'Minh',
      },
    ],
  },
  {
    name: 'In progress',
    dot: 'bg-accent',
    cards: [
      {
        id: 38,
        title: 'Offline mode for the cart',
        type: 'Feature',
        typeTone: 'bg-violet-soft text-violet',
        who: 'An',
        due: 'Nov 4',
      },
    ],
  },
  {
    name: 'In review',
    dot: 'bg-warn',
    cards: [
      {
        id: 36,
        title: 'Push notification opt-in screen',
        type: 'Feature',
        typeTone: 'bg-violet-soft text-violet',
        who: 'Hà',
      },
      {
        id: 40,
        title: 'Crash on Android 9 share sheet',
        type: 'Bug',
        typeTone: 'bg-danger-soft text-danger',
        who: 'An',
      },
    ],
  },
];

export function Board() {
  return (
    <section className="border-y border-line bg-bg-tint py-24">
      <Container className="grid grid-cols-1 items-center gap-14 [&>*]:min-w-0 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <Eyebrow>Mini App board</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.1]">
            The whole picture, one tap from the chat
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-2">
            Tap <span className="font-semibold text-ink">Open board</span> on any card and the Kanban board opens inside
            Telegram, full screen if you like. Drag a card to Done and the card in the group updates too.
          </p>
          <ul className="mt-6 space-y-3 text-[15.5px] text-ink-2">
            <li>
              <b className="text-ink">Board or list.</b> Drag-and-drop columns, or a sortable, paginated list.
            </li>
            <li>
              <b className="text-ink">Epics.</b> Group related work and watch progress fill up.
            </li>
            <li>
              <b className="text-ink">Ask AI.</b> The same assistant as{' '}
              <code className="font-mono text-[14px]">/ai</code>, in a side panel.
            </li>
          </ul>
        </div>

        <div
          className="overflow-hidden rounded-3xl border border-line bg-surface shadow-float"
          role="img"
          aria-label="TaskBot Kanban board with To do, In progress and In review columns"
        >
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <p className="font-semibold">Acme Mobile Team</p>
            <span className="ml-auto flex gap-1 rounded-lg bg-surface-2 p-0.5 text-[13px] font-medium">
              <span className="rounded-md bg-surface px-2.5 py-1 shadow-sm">Board</span>
              <span className="px-2.5 py-1 text-ink-3">List</span>
              <span className="px-2.5 py-1 text-ink-3">Epics</span>
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.name} className="rounded-2xl bg-surface-2 p-2.5">
                <p className="flex items-center gap-2 px-1 pb-2 text-[13px] font-semibold text-ink-2">
                  <span className={`size-2 rounded-full ${col.dot}`} />
                  {col.name}
                  <span className="ml-auto whitespace-nowrap text-ink-3">{col.cards.length}</span>
                </p>
                <div className="space-y-2">
                  {col.cards.map((c) => (
                    <div key={c.id} className="rounded-xl border border-line bg-surface p-3">
                      <p className="text-[13.5px] leading-snug font-medium">{c.title}</p>
                      <div className="mt-2.5 flex items-center gap-1.5 text-[11.5px]">
                        <span className={`rounded-md px-1.5 py-0.5 font-medium whitespace-nowrap ${c.typeTone}`}>
                          {c.type}
                        </span>
                        {c.due && (
                          <span className="rounded-md bg-warn-soft px-1.5 py-0.5 font-medium whitespace-nowrap text-warn">
                            {c.due}
                          </span>
                        )}
                        <span className="ml-auto whitespace-nowrap text-ink-3">
                          #{c.id} · {c.who}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

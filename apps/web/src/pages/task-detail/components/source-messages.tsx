import type { ISourceMessage, ITask } from '@tbot/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/card';
import { openTelegramLink } from '@/lib/telegram';

const LONG = 240;

export function getSourceMessages(task: ITask): ISourceMessage[] {
  if (task.sourceMessages?.length) return task.sourceMessages;
  return task.sourceMessage ? [task.sourceMessage] : [];
}

export function SourceMessages({ messages }: { messages: ISourceMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <section>
      <SectionHeading>Source message{messages.length > 1 ? 's' : ''}</SectionHeading>
      <ul className="flex flex-col gap-2">
        {messages.map((m, i) => (
          <SourceQuote key={`${m.chatId}-${m.messageId}-${i}`} message={m} />
        ))}
      </ul>
    </section>
  );
}

function SourceQuote({ message }: { message: ISourceMessage }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = (message.text?.length ?? 0) > LONG;
  const text = !isLong || expanded ? message.text : `${message.text.slice(0, LONG).trimEnd()}…`;

  return (
    <li className="rounded-r-xl border-l-4 border-tg-link bg-tg-secondary/60 px-3 py-2">
      <p className="text-xs font-semibold text-tg-link">From {message.fromName || 'a group member'}</p>
      {text ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-tg-text [overflow-wrap:anywhere]">{text}</p>
      ) : (
        <p className="mt-1 text-sm italic text-tg-hint">(no text)</p>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4">
        {isLong && (
          <Button variant="link" size="sm" onClick={() => setExpanded((e) => !e)} className="-ml-2">
            {expanded ? 'Show less' : 'Show more'}
          </Button>
        )}
        {message.link && (
          <a
            href={message.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (openTelegramLink(message.link)) e.preventDefault();
            }}
            className="focus-ring inline-flex min-h-11 items-center rounded-md text-sm font-medium text-tg-link hover:underline"
          >
            Open in chat ↗
          </a>
        )}
      </div>
    </li>
  );
}

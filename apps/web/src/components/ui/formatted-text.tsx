import type { ReactNode } from 'react';

/**
 * Renders plain text with light structure, never HTML: "Label:" lines get a bold label,
 * "• " / "- " lines become a list, blank lines separate paragraphs. Everything is a React
 * text node, so task content can't inject markup.
 */

const BULLET = /^\s*(?:[•●▪◦*]|-(?=\s))\s*(.*)$/;
// "Problem: …", "Vấn đề:", "Steps to reproduce:" — short label, starts with a letter, no URL.
const LABEL = /^(\p{L}[\p{L}\p{M}\p{N} /&'’()-]{0,38}):(?:\s+(.*))?$/u;

type Block =
  | { kind: 'label'; label: string; rest: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'text'; text: string };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    if (!line.trim()) {
      blocks.push({ kind: 'text', text: '' });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (last?.kind === 'list') last.items.push(bullet[1]);
      else blocks.push({ kind: 'list', items: [bullet[1]] });
      continue;
    }
    const label = LABEL.exec(line);
    if (label && label[1].split(/\s+/).length <= 6) {
      blocks.push({ kind: 'label', label: label[1], rest: label[2] ?? '' });
      continue;
    }
    if (last?.kind === 'text' && last.text) last.text += `\n${line}`;
    else blocks.push({ kind: 'text', text: line });
  }
  // Collapse blank-line markers into spacing.
  return blocks.filter((b, i) => !(b.kind === 'text' && !b.text && (i === 0 || i === blocks.length - 1)));
}

export function FormattedText({ text, className = '' }: { text: string; className?: string }) {
  const blocks = parse(text);
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === 'text' && !b.text) {
      out.push(<div key={i} className="h-2" aria-hidden />);
    } else if (b.kind === 'text') {
      out.push(
        <p key={i} className="whitespace-pre-wrap">
          {b.text}
        </p>,
      );
    } else if (b.kind === 'label') {
      out.push(
        <p key={i} className="mt-1 first:mt-0">
          <strong className="font-semibold">{b.label}:</strong>
          {b.rest && <> {b.rest}</>}
        </p>,
      );
    } else {
      out.push(
        <ul key={i} className="my-0.5 flex flex-col gap-0.5 pl-1">
          {b.items.map((item, j) => (
            <li key={j} className="flex gap-2">
              <span aria-hidden className="select-none text-tg-hint">
                •
              </span>
              <span className="min-w-0 flex-1">{item}</span>
            </li>
          ))}
        </ul>,
      );
    }
  });
  return <div className={`[overflow-wrap:anywhere] ${className}`}>{out}</div>;
}

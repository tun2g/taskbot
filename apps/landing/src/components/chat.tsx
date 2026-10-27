import type { CSSProperties, ReactNode } from 'react';

/** Telegram-style chat building blocks for the mocks. Purely presentational. */

const AVATAR_COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774'];

export function Avatar({ name, color }: { name: string; color?: number }) {
  const bg = AVATAR_COLORS[(color ?? name.length) % AVATAR_COLORS.length];
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white"
      style={{ background: bg }}
      aria-hidden="true"
    >
      {name[0]}
    </span>
  );
}

type BubbleProps = {
  from: string;
  color?: number;
  time: string;
  children: ReactNode;
  out?: boolean;
  delay?: number;
  nameColor?: string;
};

export function Bubble({ from, color, time, children, out, delay, nameColor }: BubbleProps) {
  const style: CSSProperties | undefined = delay !== undefined ? { animationDelay: `${delay}ms` } : undefined;
  return (
    <div
      className={`flex items-end gap-2 ${out ? 'flex-row-reverse' : ''} ${delay !== undefined ? 'rise' : ''}`}
      style={style}
    >
      {!out && <Avatar name={from} color={color} />}
      <div
        className={`max-w-[84%] rounded-2xl px-3 py-1.5 text-[14px] leading-snug text-bubble-text shadow-[0_1px_1px_rgb(0_0_0/0.08)] ${
          out ? 'rounded-br-md bg-bubble-out' : 'rounded-bl-md bg-bubble-in'
        }`}
      >
        {!out && (
          <p
            className="text-[13px] font-semibold"
            style={{ color: nameColor ?? AVATAR_COLORS[(color ?? from.length) % AVATAR_COLORS.length] }}
          >
            {from}
          </p>
        )}
        <div>{children}</div>
        <p className="mt-0.5 text-right text-[11px] text-bubble-meta">{time}</p>
      </div>
    </div>
  );
}

/** Inline keyboard under a bot message: rows of buttons. */
export function Keyboard({ rows }: { rows: string[][] }) {
  return (
    <div className="mt-1 ml-10 flex max-w-[84%] flex-col gap-1">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1">
          {row.map((label) => (
            <span
              key={label}
              className="flex-1 truncate rounded-lg bg-bubble-in/70 px-2 py-1.5 text-center text-[12.5px] font-medium text-bubble-text backdrop-blur"
            >
              {label}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Cmd({ children }: { children: ReactNode }) {
  return <span className="font-medium text-chat-link">{children}</span>;
}

export function ChatHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
      <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#5fb6f2] to-[#2a7fd0] text-sm font-bold text-white">
        {title[0]}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold">{title}</p>
        <p className="truncate text-[12.5px] text-ink-3">{subtitle}</p>
      </div>
    </div>
  );
}

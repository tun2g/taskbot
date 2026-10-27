import { Bubble, ChatHeader, Cmd } from '@/components/chat';
import { Container, Eyebrow } from '@/components/ui';

const PROMPTS = [
  '/ai move #12 to review, priority high',
  '/ai what’s left for me this week?',
  '/ai chia task #38 thành các subtask nhỏ',
  '/update #12 due Friday, assign to @an',
];

export function Ai() {
  return (
    <section className="py-24">
      <Container className="grid grid-cols-1 items-center gap-14 [&>*]:min-w-0 lg:grid-cols-2">
        <div className="order-2 overflow-hidden rounded-[28px] border border-line bg-surface shadow-float lg:order-1">
          <ChatHeader title="Acme Mobile Team" subtitle="TaskBot is replying…" />
          <div className="chat-wallpaper flex flex-col gap-2.5 px-3 py-4">
            <Bubble from="An" time="16:05" out>
              <Cmd>/ai</Cmd> còn gì của mình chưa xong không?
            </Bubble>
            <Bubble from="TaskBot" color={3} time="16:05">
              <p>Bạn còn 3 task đang mở:</p>
              <p className="mt-1">🔄 #38 Offline mode for the cart · hạn 4/11</p>
              <p>👀 #40 Crash on Android 9 share sheet</p>
              <p>📝 #47 Update onboarding copy</p>
              <p className="mt-1">#38 sắp đến hạn, nên ưu tiên trước nhé.</p>
            </Bubble>
            <Bubble from="An" time="16:06" out>
              <Cmd>/ai</Cmd> move #40 to done and give #47 to Hà
            </Bubble>
            <Bubble from="TaskBot" color={3} time="16:06">
              ✅ #40 → Done
              <br />
              👤 #47 → @ha
            </Bubble>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <Eyebrow>AI assistant</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-[2.6rem] sm:leading-[1.1]">
            Talk to your tasks like you talk to your team
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-ink-2">
            No syntax to remember. Ask a question or describe a change, in English or Vietnamese, and TaskBot answers in
            the language you used. No AI key? <code className="font-mono text-[15px]">/new</code> still creates a basic
            task.
          </p>
          <ul className="mt-7 space-y-2">
            {PROMPTS.map((p) => (
              <li
                key={p}
                className="rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[14px] text-ink-2"
              >
                {p}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}

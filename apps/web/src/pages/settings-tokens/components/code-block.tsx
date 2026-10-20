import { Button } from '@/components/ui/button';

import { useCopy } from '../use-copy';

interface CodeBlockProps {
  code: string;
  /** Accessible name for the block and its Copy button, e.g. "Claude Code command". */
  label: string;
  /** Wrap long lines (shell commands) instead of scrolling (JSON keeps its indentation). */
  wrap?: boolean;
}

/** Monospace snippet on a dark surface (readable in both themes) with a Copy button. */
export function CodeBlock({ code, label, wrap }: CodeBlockProps) {
  const copy = useCopy();
  return (
    <div className="relative overflow-hidden rounded-lg bg-[#1e1f24] text-[#e6e6e6] ring-1 ring-white/5">
      <pre
        aria-label={label}
        className={`max-h-72 overflow-auto py-3 pl-3 pr-20 font-mono text-[13px] leading-relaxed select-all ${
          wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'
        }`}
      >
        <code>{code}</code>
      </pre>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => copy(code)}
        aria-label={`Copy ${label}`}
        className="absolute right-1.5 top-1.5 bg-white/10 text-white hover:bg-white/20 active:bg-white/25"
      >
        Copy
      </Button>
    </div>
  );
}

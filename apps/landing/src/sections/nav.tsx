import { useEffect, useState } from 'react';

import { StarButton } from '@/components/star-button';
import { ButtonLink, Container, Logo, TelegramIcon } from '@/components/ui';
import { LINKS } from '@/links';

const ITEMS = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#mcp', label: 'MCP' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    // Floating bar: detached from the edges, glassy, and it lifts (shadow) once the page scrolls under it.
    <header className="fixed inset-x-0 top-3 z-40 px-3 sm:top-4">
      <Container
        className={`relative flex h-14 items-center gap-6 rounded-2xl border bg-gradient-to-r from-surface/60 via-surface/40 to-accent-soft/50 pr-2! pl-4! backdrop-blur-xl backdrop-saturate-150 transition-[box-shadow,border-color] duration-300 sm:h-16 sm:pl-5! ${
          scrolled ? 'border-line/80 shadow-float' : 'border-line/50 shadow-none'
        }`}
      >
        {/* Hairline glow along the bottom edge. */}
        <span
          className="pointer-events-none absolute inset-x-10 -bottom-px h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent"
          aria-hidden="true"
        />
        <a href="#top" className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight">
          <Logo />
          TaskBot
        </a>
        <nav className="ml-4 hidden items-center gap-6 md:flex" aria-label="Sections">
          {ITEMS.map((item) => (
            <a key={item.href} href={item.href} className="text-[15px] font-medium text-ink-2 hover:text-ink">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <StarButton className="hidden sm:inline-flex" />
          <span className="[&>a]:h-10 [&>a]:px-4 [&>a]:text-sm">
            <ButtonLink href={LINKS.addToGroup}>
              <TelegramIcon className="size-4" />
              Add to Telegram
            </ButtonLink>
          </span>
        </div>
      </Container>
    </header>
  );
}

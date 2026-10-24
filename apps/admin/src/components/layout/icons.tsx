/** Minimal stroke icons (20×20) for the sidebar. */
const paths: Record<string, string> = {
  overview: 'M3 10.5L10 4l7 6.5M5 9v7h10V9',
  groups: 'M7 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM13.5 9a2 2 0 100-4M2.5 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M13 12c2.2 0 4 1.3 4 3.5',
  users: 'M10 9.5a3 3 0 100-6 3 3 0 000 6zM4 17c0-3 2.7-5 6-5s6 2 6 5',
  ai: 'M10 3v2M10 15v2M3 10h2M15 10h2M6 6l1.2 1.2M12.8 12.8L14 14M6 14l1.2-1.2M12.8 7.2L14 6M10 7.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
  mcp: 'M7 6l-4 4 4 4M13 6l4 4-4 4M11 4l-2 12',
  system: 'M3 5h14v4H3zM3 11h14v4H3zM6 7h.01M6 13h.01',
  audit: 'M6 3h8l3 3v11H3V3h3zM6 9h8M6 12h8M6 15h5',
  settings:
    'M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16 10l1.5-1-1-2.5-1.8.3-1.2-1.2.3-1.8L11.3 2.8 10 4.3 8.7 2.8 6.2 3.8l.3 1.8-1.2 1.2-1.8-.3-1 2.5L4 10l-1.5 1 1 2.5 1.8-.3 1.2 1.2-.3 1.8 2.5 1 1.3-1.5 1.3 1.5 2.5-1-.3-1.8 1.2-1.2 1.8.3 1-2.5z',
  menu: 'M3 6h14M3 10h14M3 14h14',
};

export function NavIcon({ name, className = 'size-[18px]' }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

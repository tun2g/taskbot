/** The main navigation (sidebar + the page name on the phone header). */
export const NAV = [
  { to: '/', label: 'Overview', icon: 'overview', exact: true },
  { to: '/groups', label: 'Groups', icon: 'groups' },
  { to: '/users', label: 'People', icon: 'users' },
  { to: '/ai', label: 'AI & cost', icon: 'ai' },
  { to: '/mcp', label: 'MCP', icon: 'mcp' },
  { to: '/system', label: 'System', icon: 'system' },
  { to: '/audit-log', label: 'Audit log', icon: 'audit' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const;

/** Pages whose numbers depend on the date range (the selector only shows there). */
export const RANGED = [/^\/$/, /^\/groups\/[^/]+$/, /^\/users(\/[^/]+)?$/, /^\/ai$/, /^\/mcp$/];

/** The section the current path belongs to ("/groups/abc" → "Groups"). */
export function currentSection(pathname: string): string | null {
  const item = NAV.find((n) =>
    'exact' in n ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`),
  );
  return item?.label ?? null;
}

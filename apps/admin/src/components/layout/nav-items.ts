/** The main navigation (sidebar + the page name on the phone header). */
export const NAV = [
  { to: '/', label: 'Overview', icon: 'overview', exact: true, section: 'Workspaces' },
  { to: '/groups', label: 'Groups', icon: 'groups', section: 'Workspaces' },
  { to: '/users', label: 'People', icon: 'users', section: 'Workspaces' },
  { to: '/ai', label: 'AI & cost', icon: 'ai', section: 'Usage' },
  { to: '/mcp', label: 'MCP', icon: 'mcp', section: 'Usage' },
  { to: '/system', label: 'System', icon: 'system', section: 'Admin' },
  { to: '/audit-log', label: 'Audit log', icon: 'audit', section: 'Admin' },
  { to: '/settings', label: 'Settings', icon: 'settings', section: 'Admin' },
] as const;

/** Sidebar headings, in order (Metabase-style small caps labels above each block of links). */
export const NAV_SECTIONS = ['Workspaces', 'Usage', 'Admin'] as const;

/** Pages whose numbers depend on the date range (the selector only shows there). */
export const RANGED = [/^\/$/, /^\/groups\/[^/]+$/, /^\/users(\/[^/]+)?$/, /^\/ai$/, /^\/mcp$/];

/** The section the current path belongs to ("/groups/abc" → "Groups"). */
export function currentSection(pathname: string): string | null {
  const item = NAV.find((n) =>
    'exact' in n ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`),
  );
  return item?.label ?? null;
}

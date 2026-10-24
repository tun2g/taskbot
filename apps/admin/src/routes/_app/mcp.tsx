import { createFileRoute } from '@tanstack/react-router';

import { validateMcpSearch } from '@/lib/search';
import { McpPage } from '@/pages/mcp/mcp.page';

export const Route = createFileRoute('/_app/mcp')({
  validateSearch: validateMcpSearch,
  component: McpPage,
});

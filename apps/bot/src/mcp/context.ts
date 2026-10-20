import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';

/** Who is calling a tool: the token's user, the client's "(via …)" label and the token's group scope. */
export interface McpContext {
  user: IUser;
  /** "Claude Code", "Cursor", … or "MCP". */
  clientLabel: string;
  /** The one group a group-scoped token works for (membership already checked); null = all the user's groups. */
  scopeGroup: IGroup | null;
}

/** A tool failure the model can act on — returned as `isError` with this text. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpToolError';
  }
}

/** What every tool returns: a short text for the model to read and the same facts as JSON. */
export interface ToolOutput {
  text: string;
  data: Record<string, unknown>;
}

/** Activity-log channel + "(via Claude Code)" label for changes made through MCP. */
export const mcpChannel = (ctx: McpContext): { activity: 'mcp'; label: string } => ({
  activity: 'mcp',
  label: ctx.clientLabel,
});

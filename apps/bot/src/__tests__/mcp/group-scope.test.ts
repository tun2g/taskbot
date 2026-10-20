import { checkGroupAccess } from 'src/api/middlewares/group-access.middleware';
import { Group } from 'src/database/models/group.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { requireGroup } from 'src/mcp/resolve/group';
import { alpha, beta, ctx, expectToolError, oid } from './mcp-test-helpers';

jest.mock('src/api/middlewares/group-access.middleware', () => ({ checkGroupAccess: jest.fn() }));
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/database/services/group-member.service', () => ({ groupMemberService: { getUserGroups: jest.fn() } }));

const alphaTwo = { _id: oid(), groupName: 'team alpha', telegramGroupId: -9 } as any;

function userIn(...groups: any[]) {
  (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue(groups.map((g) => g._id));
  (Group.find as jest.Mock).mockReturnValue({ sort: jest.fn().mockResolvedValue(groups) });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkGroupAccess as jest.Mock).mockImplementation(async (id: string) => {
    const group = [alpha, beta, alphaTwo].find((g) => String(g._id) === id);
    return group ? { ok: true, group } : { ok: false, status: 404, message: 'x' };
  });
});

describe('requireGroup — all-groups token', () => {
  it('accepts an id', async () => {
    userIn(alpha, beta);
    expect(await requireGroup(ctx(), String(beta._id))).toBe(beta);
    expect(checkGroupAccess).toHaveBeenCalledWith(String(beta._id), expect.anything());
  });

  it('accepts a title, case-insensitively', async () => {
    userIn(alpha, beta);
    expect(await requireGroup(ctx(), 'TEAM beta')).toBe(beta);
  });

  it('accepts a unique partial title', async () => {
    userIn(alpha, beta);
    expect(await requireGroup(ctx(), 'beta')).toBe(beta);
  });

  it('an ambiguous title lists the matches with ids', async () => {
    userIn(alpha, alphaTwo, beta);
    await expectToolError(
      requireGroup(ctx(), 'Team Alpha'),
      /Several of your groups match "Team Alpha".*Pass the group id/,
    );
  });

  it("an unknown title lists the user's groups", async () => {
    userIn(alpha, beta);
    await expectToolError(
      requireGroup(ctx(), 'Gamma'),
      /None of your groups is called "Gamma". Your groups: "Team Alpha"/,
    );
  });

  it('is optional when the user is in exactly one group', async () => {
    userIn(alpha);
    expect(await requireGroup(ctx())).toBe(alpha);
  });

  it('missing with several groups → error listing them so the agent can ask', async () => {
    userIn(alpha, beta);
    await expectToolError(requireGroup(ctx()), /Which group\?.*"Team Alpha".*"Team Beta".*ask them/);
  });

  it('an id of a group the user is not in is denied', async () => {
    userIn(alpha);
    await expectToolError(requireGroup(ctx(), String(oid())), /don't have access to that group/);
  });
});

describe('requireGroup — group-scoped token', () => {
  it('always uses the token group (group optional, its id or title accepted)', async () => {
    const scoped = ctx({ scopeGroup: alpha });
    expect(await requireGroup(scoped)).toBe(alpha);
    expect(await requireGroup(scoped, String(alpha._id))).toBe(alpha);
    expect(await requireGroup(scoped, 'team alpha')).toBe(alpha);
    expect(checkGroupAccess).not.toHaveBeenCalled();
  });

  it('another group → "This token only works for group X"', async () => {
    await expectToolError(
      requireGroup(ctx({ scopeGroup: alpha }), String(beta._id)),
      /This token only works for group "Team Alpha"/,
    );
  });
});

/**
 * Dev-only fixture data (VITE_ADMIN_MOCK=1). Deterministic (seeded) so screenshots are stable, and every
 * aggregate is computed from the same raw rows — AI totals add up to the calls behind them, like the real API.
 */
import type {
  AdminAiCallRow,
  AdminAiSettings,
  AdminAuditEntry,
  AdminGroupRow,
  AdminPersonRef,
  AiCallStatus,
  UsageChannel,
} from '@tbot/shared';
import { AiFeature, GroupStatus } from '@tbot/shared';

let seed = 42;
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
export const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

const DAY = 86_400_000;
export const now = Date.now();
export const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
export const dayStr = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString().slice(0, 10);
const oid = (n: number) => `6710${String(n).padStart(20, '0')}`;

/** Stats tracking was deployed 12 days ago — 30d / 90d ranges show the "tracking started" notice. */
export const TRACKING_SINCE_DAYS_AGO = 12;
export const trackingSince = dayStr(TRACKING_SINCE_DAYS_AGO);

// ── People ──────────────────────────────────────────────────────────────────

export const people: (AdminPersonRef & { id: string; createdDaysAgo: number })[] = [
  ['Linh Nguyen', 'linhng'],
  ['Minh Tran', 'minhtran'],
  ['Sarah Kim', 'sarahk'],
  ['Duc Pham', null],
  ['Alex Morgan', 'amorgan'],
  ['Hoa Le', 'hoale'],
  ['Tom Becker', 'tbecker'],
  ['Quang Vo', 'quangvo'],
  ['Priya Shah', 'priyas'],
  ['Khanh Do', null],
  ['Jonas Weber', 'jweber'],
  ['Mai Anh', 'maianh'],
  ['Ravi Patel', 'ravip'],
  ['Elena Rossi', 'erossi'],
].map(([name, username], i) => ({
  id: oid(100 + i),
  telegramUserId: 50_000_000 + i * 7919,
  name: name as string,
  username: username as string | null,
  createdDaysAgo: int(15, 200),
}));

export const personRef = (p: (typeof people)[number]): AdminPersonRef => ({
  id: p.id,
  telegramUserId: p.telegramUserId,
  name: p.name,
  username: p.username,
});

// ── Groups ──────────────────────────────────────────────────────────────────

interface GroupSeed {
  name: string;
  status: GroupStatus;
  isForum?: boolean;
  memberCount: number | null;
  members: number[];
  tasks: number;
  openTasks: number;
  addedDaysAgo: number;
  lastActivityHoursAgo: number | null;
  reason?: string;
  statusChangedDaysAgo?: number;
  aiDisabled?: boolean;
  aiDailyLimit?: number | null;
  /** Relative AI usage weight. */
  aiWeight: number;
  /** Uses a model with no price → unpriced calls. */
  unpricedModel?: boolean;
  publicLink?: string;
}

const GROUP_SEEDS: GroupSeed[] = [
  { name: 'Acme Mobile Team', status: GroupStatus.ACTIVE, isForum: true, memberCount: 42, members: [0, 1, 2, 3, 4, 5, 6], tasks: 128, openTasks: 37, addedDaysAgo: 160, lastActivityHoursAgo: 0.2, aiWeight: 10 },
  { name: 'Saigon Devs', status: GroupStatus.ACTIVE, memberCount: 18, members: [1, 7, 8, 9], tasks: 86, openTasks: 21, addedDaysAgo: 120, lastActivityHoursAgo: 1.5, aiWeight: 5, publicLink: 'https://t.me/saigondevs' },
  { name: 'Night Shift Ops', status: GroupStatus.ACTIVE, memberCount: 9, members: [3, 10, 11], tasks: 54, openTasks: 12, addedDaysAgo: 75, lastActivityHoursAgo: 3, aiWeight: 4, unpricedModel: true },
  { name: 'Design Guild', status: GroupStatus.ACTIVE, isForum: true, memberCount: 23, members: [2, 5, 12, 13], tasks: 61, openTasks: 18, addedDaysAgo: 90, lastActivityHoursAgo: 6, aiWeight: 2 },
  { name: 'Research Lab', status: GroupStatus.ACTIVE, memberCount: 7, members: [8, 13], tasks: 33, openTasks: 9, addedDaysAgo: 40, lastActivityHoursAgo: 26, aiWeight: 3, aiDailyLimit: 50 },
  { name: 'Indie Game Jam', status: GroupStatus.ACTIVE, memberCount: 31, members: [4, 6, 10], tasks: 19, openTasks: 11, addedDaysAgo: 30, lastActivityHoursAgo: 50, aiWeight: 0.5, aiDisabled: true, statusChangedDaysAgo: 30 },
  { name: 'Hanoi Marketing', status: GroupStatus.PENDING, memberCount: 14, members: [11], tasks: 0, openTasks: 0, addedDaysAgo: 0.08, lastActivityHoursAgo: 2, aiWeight: 0 },
  { name: 'Book Club Planning', status: GroupStatus.PENDING, memberCount: 6, members: [12], tasks: 0, openTasks: 0, addedDaysAgo: 1.2, lastActivityHoursAgo: 28, aiWeight: 0 },
  { name: 'Freelance Crew', status: GroupStatus.PENDING, isForum: true, memberCount: 57, members: [9], tasks: 0, openTasks: 0, addedDaysAgo: 3.4, lastActivityHoursAgo: 80, aiWeight: 0 },
  { name: 'Old Startup HQ', status: GroupStatus.SUSPENDED, memberCount: 12, members: [0, 7], tasks: 212, openTasks: 64, addedDaysAgo: 300, lastActivityHoursAgo: 24 * 9, reason: 'Paused until the team confirms they still need it.', statusChangedDaysAgo: 9, aiWeight: 0.3 },
  { name: 'Crypto Signals 💰', status: GroupStatus.REJECTED, memberCount: 1840, members: [], tasks: 0, openTasks: 0, addedDaysAgo: 20, lastActivityHoursAgo: 24 * 20, reason: 'Not a work group.', statusChangedDaysAgo: 20, aiWeight: 0 },
  { name: 'Family Chores', status: GroupStatus.LEFT, memberCount: null, members: [5], tasks: 14, openTasks: 3, addedDaysAgo: 140, lastActivityHoursAgo: 24 * 33, statusChangedDaysAgo: 33, aiWeight: 0 },
  { name: 'Design Guild (old chat)', status: GroupStatus.MIGRATED, memberCount: null, members: [2], tasks: 0, openTasks: 0, addedDaysAgo: 200, lastActivityHoursAgo: 24 * 92, statusChangedDaysAgo: 92, aiWeight: 0 },
];

export type MockGroup = AdminGroupRow & {
  seed: GroupSeed;
  timezone: string;
  approvedAt: string | null;
  botLeftAt: string | null;
  migratedToChatId: number | null;
  publicLink: string | null;
  epics: number;
  activities: number;
  activeTokens: number;
};

export const groups: MockGroup[] = GROUP_SEEDS.map((g, i) => {
  const addedBy = g.members.length ? personRef(people[g.members[0]!]!) : personRef(people[13]!);
  return {
    id: oid(500 + i),
    name: g.name,
    status: g.status,
    telegramGroupId: -1001_000_000_000 - i * 104_729,
    isForum: !!g.isForum,
    memberCount: g.memberCount,
    knownMembers: g.members.length,
    tasks: g.tasks,
    openTasks: g.openTasks,
    lastActivityAt: g.lastActivityHoursAgo == null ? null : iso(g.lastActivityHoursAgo * 3_600_000),
    aiCostUsd30d: 0,
    aiCalls30d: 0,
    addedBy,
    addedAt: iso(g.addedDaysAgo * DAY),
    statusReason: g.reason ?? null,
    statusChangedAt: g.statusChangedDaysAgo != null ? iso(g.statusChangedDaysAgo * DAY) : null,
    aiDisabled: !!g.aiDisabled,
    aiDailyLimit: g.aiDailyLimit ?? null,
    createdAt: iso(g.addedDaysAgo * DAY),
    seed: g,
    timezone: i % 3 === 0 ? 'Asia/Ho_Chi_Minh' : i % 3 === 1 ? 'Europe/Berlin' : 'UTC',
    approvedAt: g.status === GroupStatus.PENDING || g.status === GroupStatus.REJECTED ? null : iso((g.addedDaysAgo - 0.1) * DAY),
    botLeftAt: g.status === GroupStatus.LEFT ? iso((g.statusChangedDaysAgo ?? 1) * DAY) : null,
    migratedToChatId: g.status === GroupStatus.MIGRATED ? -1001_000_000_000 - 3 * 104_729 : null,
    publicLink: g.publicLink ?? null,
    epics: Math.round(g.tasks / 20),
    activities: g.tasks * 6,
    activeTokens: g.status === GroupStatus.ACTIVE ? Math.min(g.members.length, int(0, 3)) : 0,
  };
});

// ── AI calls ────────────────────────────────────────────────────────────────

/** USD per 1M tokens. */
export const builtInPricing: AdminAiSettings['defaults']['builtInPricing'] = {
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.075, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
};

export const settings: AdminAiSettings = {
  dailyCallLimit: 400,
  dailyBudgetUsd: 1.5,
  alertAtPercent: 80,
  userDailyLimit: 40,
  pricing: { 'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 } },
  lastChangedAt: iso(6 * DAY),
  defaults: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    envDailyCallLimit: 0,
    userDailyLimit: 30,
    builtInPricing,
  },
};

const UNPRICED_MODEL = 'gemini-2.5-pro-preview-09';

function priceOf(model: string) {
  return settings.pricing[model] ?? builtInPricing[model];
}

const FEATURE_WEIGHTS: [AiFeature, number][] = [
  [AiFeature.PLANNER, 0.45],
  [AiFeature.EXTRACT, 0.25],
  [AiFeature.EXPLAIN, 0.15],
  [AiFeature.BREAKDOWN, 0.12],
  [AiFeature.OTHER, 0.03],
];

function weightedFeature(): AiFeature {
  let r = rand();
  for (const [f, w] of FEATURE_WEIGHTS) {
    if ((r -= w) <= 0) return f;
  }
  return AiFeature.OTHER;
}

/** Refused before reaching the provider (a limit, or AI turned off). */
export const refused = (s: AiCallStatus) => s === 'quota' || s === 'disabled';

const ERRORS = ['Provider timed out after 30 s', '503 Service Unavailable from provider', 'Rate limited by provider (429)'];

export const aiCalls: AdminAiCallRow[] = [];
{
  let n = 0;
  const totalWeight = groups.reduce((s, g) => s + g.seed.aiWeight, 0);
  for (let daysAgo = TRACKING_SINCE_DAYS_AGO; daysAgo >= 0; daysAgo--) {
    // Usage grows a little each day; today is partial.
    const perDay = daysAgo === 0 ? 46 : int(70, 110) + (TRACKING_SINCE_DAYS_AGO - daysAgo) * 3;
    for (let k = 0; k < perDay; k++) {
      let r = rand() * totalWeight;
      const group = groups.find((g) => (r -= g.seed.aiWeight) <= 0) ?? groups[0]!;
      const memberIdx = group.seed.members.length ? pick(group.seed.members) : 0;
      const person = people[memberIdx]!;
      const feature = weightedFeature();
      const model = group.seed.unpricedModel && rand() < 0.6 ? UNPRICED_MODEL : rand() < 0.85 ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite';
      const sr = rand();
      const status: AiCallStatus = group.aiDisabled ? 'disabled' : sr < 0.93 ? 'ok' : sr < 0.97 ? 'failed' : sr < 0.99 ? 'invalid' : 'quota';
      const inputTokens = refused(status) ? 0 : int(feature === AiFeature.EXTRACT ? 2500 : 900, feature === AiFeature.EXTRACT ? 9000 : 4200);
      const cachedTokens = refused(status) ? 0 : Math.round(inputTokens * (rand() < 0.4 ? rand() * 0.6 : 0));
      const outputTokens = status === 'ok' || status === 'invalid' ? int(80, feature === AiFeature.BREAKDOWN ? 1400 : 700) : 0;
      const price = priceOf(model);
      const costUsd = price
        ? ((inputTokens - cachedTokens) * price.input + cachedTokens * (price.cachedInput ?? price.input) + outputTokens * price.output) / 1_000_000
        : 0;
      const msAgo = daysAgo * DAY + Math.floor(rand() * (daysAgo === 0 ? (now % DAY) : DAY));
      aiCalls.push({
        id: oid(10_000 + n++),
        at: iso(msAgo),
        feature,
        provider: 'gemini',
        model,
        status,
        attempt: status === 'failed' && rand() < 0.5 ? 2 : 1,
        latencyMs: refused(status) ? 0 : int(600, status === 'failed' ? 30_000 : 6_500),
        inputTokens,
        cachedTokens,
        outputTokens,
        costUsd,
        priced: !!price || refused(status),
        group: { id: group.id, name: group.name, status: group.status },
        person: personRef(person),
        channel: feature === AiFeature.PLANNER ? pick<UsageChannel>(['telegram', 'telegram', 'app']) : pick<UsageChannel>(['telegram', 'app', 'mcp']),
        error: status === 'failed' ? pick(ERRORS) : status === 'invalid' ? 'Model reply was not valid JSON' : status === 'quota' ? 'Daily AI limit reached for this group' : status === 'disabled' ? 'AI is turned off for this group' : null,
      });
    }
  }
  aiCalls.sort((a, b) => b.at.localeCompare(a.at));
  // A group deleted 8 days ago: its earlier AI calls stay in the history (and in every total).
  const deleted: AdminAiCallRow['group'] = { id: oid(8_888), name: 'Weekend Hikers', status: GroupStatus.LEFT };
  for (const c of aiCalls) {
    const ago = (now - new Date(c.at).getTime()) / DAY;
    if (ago > 8 && ago < 11 && c.feature === AiFeature.EXPLAIN) c.group = deleted;
  }
  for (const g of groups) {
    const mine = aiCalls.filter((c) => c.group?.id === g.id);
    g.aiCalls30d = mine.length;
    g.aiCostUsd30d = mine.reduce((s, c) => s + c.costUsd, 0);
  }
}

// ── Audit log ───────────────────────────────────────────────────────────────

const g = (name: string) => groups.find((x) => x.name === name)!;

export const auditLog: AdminAuditEntry[] = [
  { id: oid(9001), at: iso(9 * DAY), action: 'group.suspend', summary: 'Suspended group “Old Startup HQ”', targetType: 'group', targetId: g('Old Startup HQ').id, targetLabel: 'Old Startup HQ', reason: 'Paused until the team confirms they still need it.', details: { notifiedGroup: true } },
  { id: oid(9002), at: iso(20 * DAY), action: 'group.reject', summary: 'Rejected group “Crypto Signals 💰”', targetType: 'group', targetId: g('Crypto Signals 💰').id, targetLabel: 'Crypto Signals 💰', reason: 'Not a work group.', details: { notifiedGroup: true } },
  { id: oid(9003), at: iso(30 * DAY), action: 'group.ai', summary: 'Changed AI limits for group “Indie Game Jam”', targetType: 'group', targetId: g('Indie Game Jam').id, targetLabel: 'Indie Game Jam', reason: null, details: { disabled: true }, changes: ['AI turned off'] },
  { id: oid(9004), at: iso(6 * DAY), action: 'settings.ai.update', summary: 'Changed AI settings', targetType: 'settings', targetId: null, targetLabel: 'AI settings', reason: null, details: {
      before: { dailyCallLimit: 500, dailyBudgetUsd: null, alertAtPercent: 80, userDailyLimit: 40, pricing: {} },
      after: { dailyCallLimit: 400, dailyBudgetUsd: 1.5, alertAtPercent: 80, userDailyLimit: 40, pricing: { 'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 } } },
    },
    changes: ['Daily AI call limit: 500 → 400', 'Daily budget: none → $1.50', 'gemini-2.5-flash cached input: $0.075 → $0.03 per 1M tokens'] },
  { id: oid(9005), at: iso(2 * 3_600_000), action: 'auth.login', summary: 'Signed in to the admin app', targetType: 'session', targetId: null, targetLabel: null, reason: null, details: { browser: 'Chrome on Mac', ip: '113.161.42.7' }, changes: ['Chrome on Mac · 113.161.42.7'] },
  { id: oid(9010), at: iso(3 * DAY), action: 'auth.login', summary: 'Signed in to the admin app', targetType: 'session', targetId: null, targetLabel: null, reason: null, details: { browser: 'Safari on iPhone', ip: '27.72.98.15' }, changes: ['Safari on iPhone · 27.72.98.15'] },
  { id: oid(9006), at: iso(40 * DAY), action: 'group.approve', summary: 'Approved group “Research Lab”', targetType: 'group', targetId: g('Research Lab').id, targetLabel: 'Research Lab', reason: null, details: null },
  { id: oid(9008), at: iso(14 * DAY), action: 'group.reject', summary: 'Rejected group “Book Club Planning”', targetType: 'group', targetId: g('Book Club Planning').id, targetLabel: 'Book Club Planning', reason: 'Looks like a personal chat, not a work team.', details: null },
  { id: oid(9009), at: iso(8 * DAY), action: 'group.delete', summary: 'Deleted group “Weekend Hikers”', targetType: 'group', targetId: oid(8_888), targetLabel: 'Weekend Hikers', reason: null, details: null, changes: ['Removed 41 tasks, 2 epics, 9 member links and 120 activity entries; revoked 1 MCP token'] },
  { id: oid(9007), at: iso(4 * DAY), action: 'user.revoke_tokens', summary: 'Revoked all MCP tokens of Tom Becker', targetType: 'user', targetId: people[6]!.id, targetLabel: 'Tom Becker', reason: null, details: { revoked: 2 }, changes: ['2 tokens revoked'] },
].sort((a, b) => b.at.localeCompare(a.at)) as AdminAuditEntry[];

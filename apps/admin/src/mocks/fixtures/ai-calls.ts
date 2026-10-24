/**
 * Every AI call since tracking started. Aggregates (group cost, person totals, the AI page) are all computed
 * from these rows, so the totals add up to the calls behind them like the real API.
 */
import type { AdminAiCallRow, AiCallStatus, UsageChannel } from '@tbot/shared';
import { AiFeature, GroupStatus } from '@tbot/shared';

import { DAY, iso, now, TRACKING_SINCE_DAYS_AGO } from './clock';
import { groups, type MockGroup } from './groups';
import { people, personRef } from './people';
import { int, oid, pick, rand } from './random';
import { priceOf } from './settings';

const UNPRICED_MODEL = 'gemini-2.5-pro-preview-09';

const FEATURE_WEIGHTS: [AiFeature, number][] = [
  [AiFeature.PLANNER, 0.45],
  [AiFeature.EXTRACT, 0.25],
  [AiFeature.EXPLAIN, 0.15],
  [AiFeature.BREAKDOWN, 0.12],
  [AiFeature.OTHER, 0.03],
];

const ERRORS = ['Provider timed out after 30 s', '503 Service Unavailable from provider', 'Rate limited by provider (429)'];

/** Refused before reaching the provider (a limit, or AI turned off). */
export const refused = (s: AiCallStatus) => s === 'quota' || s === 'disabled';

function weightedFeature(): AiFeature {
  let r = rand();
  for (const [f, w] of FEATURE_WEIGHTS) {
    if ((r -= w) <= 0) return f;
  }
  return AiFeature.OTHER;
}

function pickGroup(totalWeight: number): MockGroup {
  let r = rand() * totalWeight;
  return groups.find((g) => (r -= g.seed.aiWeight) <= 0) ?? groups[0]!;
}

function pickModel(group: MockGroup): string {
  if (group.seed.allUnpriced) return UNPRICED_MODEL;
  return group.seed.unpricedModel && rand() < 0.6 ? UNPRICED_MODEL : rand() < 0.85 ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite';
}

function errorOf(status: AiCallStatus): string | null {
  if (status === 'failed') return pick(ERRORS);
  if (status === 'invalid') return 'Model reply was not valid JSON';
  if (status === 'quota') return 'Daily AI budget of 400 calls reached';
  if (status === 'disabled') return 'AI is turned off for this group';
  return null;
}

/** One random call `daysAgo` days back (the order of `rand()` calls keeps the fixtures stable). */
function makeCall(n: number, daysAgo: number, totalWeight: number): AdminAiCallRow {
  const group = pickGroup(totalWeight);
  const memberIdx = group.seed.members.length ? pick(group.seed.members) : 0;
  const person = people[memberIdx]!;
  const feature = weightedFeature();
  const model = pickModel(group);
  const sr = rand();
  const status: AiCallStatus = group.aiDisabled ? 'disabled' : sr < 0.93 ? 'ok' : sr < 0.97 ? 'failed' : sr < 0.99 ? 'invalid' : 'quota';
  const inputTokens = refused(status) ? 0 : int(feature === AiFeature.EXTRACT ? 2500 : 900, feature === AiFeature.EXTRACT ? 9000 : 4200);
  const cachedTokens = refused(status) ? 0 : Math.round(inputTokens * (rand() < 0.4 ? rand() * 0.6 : 0));
  const outputTokens = status === 'ok' || status === 'invalid' ? int(80, feature === AiFeature.BREAKDOWN ? 1400 : 700) : 0;
  const price = priceOf(model);
  const costUsd = price
    ? ((inputTokens - cachedTokens) * price.input + cachedTokens * (price.cachedInput ?? price.input) + outputTokens * price.output) / 1_000_000
    : 0;
  const msAgo = daysAgo * DAY + Math.floor(rand() * (daysAgo === 0 ? now % DAY : DAY));
  return {
    id: oid(10_000 + n),
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
    error: errorOf(status),
  };
}

function generateCalls(): AdminAiCallRow[] {
  const calls: AdminAiCallRow[] = [];
  const totalWeight = groups.reduce((s, g) => s + g.seed.aiWeight, 0);
  for (let daysAgo = TRACKING_SINCE_DAYS_AGO; daysAgo >= 0; daysAgo--) {
    // Usage grows a little each day; today is partial.
    const perDay = daysAgo === 0 ? 46 : int(70, 110) + (TRACKING_SINCE_DAYS_AGO - daysAgo) * 3;
    for (let k = 0; k < perDay; k++) calls.push(makeCall(calls.length, daysAgo, totalWeight));
  }
  return calls.sort((a, b) => b.at.localeCompare(a.at));
}

/** Like the real bot: MCP calls and some Mini App ones (the home screen) aren't tied to a group → "No group" rows. */
function detachUngrouped(calls: AdminAiCallRow[]) {
  calls.forEach((c, k) => {
    if (c.status !== 'disabled' && (c.channel === 'mcp' || (c.channel === 'app' && k % 3 === 0))) c.group = null;
  });
}

/** A group deleted 8 days ago: its earlier AI calls stay in the history (and in every total). */
function addDeletedGroup(calls: AdminAiCallRow[]) {
  const deleted: AdminAiCallRow['group'] = { id: oid(8_888), name: 'Weekend Hikers', status: GroupStatus.LEFT };
  for (const c of calls) {
    const ago = (now - new Date(c.at).getTime()) / DAY;
    if (ago > 8 && ago < 11 && c.feature === AiFeature.EXPLAIN) c.group = deleted;
  }
}

function fillGroupTotals(calls: AdminAiCallRow[]) {
  for (const g of groups) {
    const mine = calls.filter((c) => c.group?.id === g.id);
    g.aiCalls30d = mine.length;
    g.aiCostUsd30d = mine.reduce((s, c) => s + c.costUsd, 0);
  }
}

export const aiCalls: AdminAiCallRow[] = generateCalls();
detachUngrouped(aiCalls);
addDeletedGroup(aiCalls);
fillGroupTotals(aiCalls);

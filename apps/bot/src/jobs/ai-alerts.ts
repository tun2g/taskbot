import mongoose from 'mongoose';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { StatsDaily } from 'src/database/models/stats-daily.model';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { settingsService } from 'src/shared/services/settings.service';
import { addDays, DailyRow } from 'src/shared/services/stats/daily-stats';
import { adminLink } from 'src/shared/utils/app-links';

/** A group's AI calls today must exceed this many times its 7-day daily average… */
export const SPIKE_FACTOR = 5;
/** …and this many calls, so a quiet group going from 1 to 6 calls isn't "unusual". */
export const SPIKE_MIN_CALLS = 30;
const SPIKE_BASELINE_DAYS = 7;
const ALERT_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

export interface AlertGroupLine {
  name: string;
  costUsd: number;
  calls: number;
}

/** Sends a plain-text DM to the owner (injected in tests). */
export type OwnerNotifier = (chatId: number, text: string) => Promise<unknown>;

const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

/**
 * Thresholds (% of the daily budget) reached by `costUsd`, highest first: the owner's alert % and 100%.
 * Empty when no budget is set or nothing is reached yet.
 */
export function reachedThresholds(costUsd: number, budgetUsd: number | null, alertAtPercent: number): number[] {
  if (!budgetUsd || budgetUsd <= 0) return [];
  const percents = [...new Set([Math.min(alertAtPercent, 100), 100])].sort((a, b) => b - a);
  return percents.filter((p) => costUsd >= (budgetUsd * p) / 100);
}

export function budgetAlertText(input: {
  costUsd: number;
  budgetUsd: number;
  threshold: number;
  calls: number;
  unpriced: number;
  topGroups: AlertGroupLine[];
  /** Admin app page to act on it (ADMIN_URL), if configured. */
  link?: string | null;
}): string {
  const percent = Math.floor((input.costUsd / input.budgetUsd) * 100);
  const head =
    input.threshold >= 100
      ? `🛑 AI spend today reached your daily budget: ${usd(input.costUsd)} of ${usd(input.budgetUsd)} (${percent}%).`
      : `⚠️ AI spend today is at ${percent}% of your daily budget: ${usd(input.costUsd)} of ${usd(input.budgetUsd)}.`;
  const lines = [head, ''];
  if (input.topGroups.length) {
    lines.push('Top groups today:');
    input.topGroups.forEach((g, i) => lines.push(`${i + 1}. ${g.name} — ${usd(g.costUsd)} (${g.calls} calls)`));
    lines.push('');
  }
  lines.push(
    `AI calls today: ${input.calls}${input.unpriced ? ` (${input.unpriced} with an unknown price, not counted in the cost)` : ''}.`,
  );
  lines.push(
    input.threshold >= 100
      ? 'AI keeps working. To stop spending, set a daily call limit or turn AI off for a group in the admin app.'
      : 'Nothing is blocked. You can set a daily call limit or turn AI off for a group in the admin app.',
  );
  if (input.link) lines.push(`Open: ${input.link}`);
  return lines.join('\n');
}

export interface Spike {
  groupId: string;
  calls: number;
  costUsd: number;
  /** Average AI calls per day over the previous 7 days. */
  average: number;
}

/** Groups whose AI calls today are > SPIKE_FACTOR × their 7-day daily average and > SPIKE_MIN_CALLS. */
export function findSpikes(today: DailyRow[], baselineCalls: Record<string, number>, baselineDays = SPIKE_BASELINE_DAYS): Spike[] {
  return today
    .filter((r) => r.groupId && r.aiCalls > SPIKE_MIN_CALLS)
    .map((r) => ({
      groupId: r.groupId as string,
      calls: r.aiCalls,
      costUsd: r.aiCostUsd,
      average: (baselineCalls[r.groupId as string] ?? 0) / baselineDays,
    }))
    .filter((s) => s.calls > SPIKE_FACTOR * s.average);
}

export function spikeAlertText(name: string, spike: Spike, link?: string | null): string {
  const usual = spike.average < 1 ? 'usually almost none' : `usually about ${Math.round(spike.average)} a day`;
  return [
    `📈 Unusual AI use in “${name}”`,
    `Today: ${spike.calls} AI calls so far (${usd(spike.costUsd)}) — ${usual} over the last ${SPIKE_BASELINE_DAYS} days.`,
    'You can set a daily AI limit for this group or turn its AI off in the admin app.',
    ...(link ? [`Open: ${link}`] : []),
  ].join('\n');
}

/** Once per key (per day): false when already sent. On a Redis error, don't send (no repeated DMs). */
async function claim(key: string): Promise<boolean> {
  try {
    return (await redisService.set(key, '1', { NX: true, EX: ALERT_KEY_TTL_SECONDS })) === 'OK';
  } catch (error) {
    logger.warn(`[AiAlerts] Could not claim ${key}: ${error}`);
    return false;
  }
}

async function groupNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const groups = await Group.find({ _id: { $in: ids } }, { groupName: 1 }).lean();
  return Object.fromEntries((groups as { _id: unknown; groupName: string }[]).map((g) => [String(g._id), g.groupName]));
}

/** AI calls per group over the `days` days before `day` (from stats_daily). */
async function baselineCalls(day: string, days = SPIKE_BASELINE_DAYS): Promise<Record<string, number>> {
  const from = addDays(day, -days);
  const rows = await StatsDaily.find({ day: { $gte: from, $lt: day }, groupId: { $ne: null } }, { groupId: 1, aiCalls: 1 }).lean();
  const out: Record<string, number> = {};
  for (const r of rows as { groupId: mongoose.Types.ObjectId; aiCalls: number }[]) {
    const key = String(r.groupId);
    out[key] = (out[key] ?? 0) + (r.aiCalls ?? 0);
  }
  return out;
}

/**
 * Hourly: DMs the bot owner when today's AI spend reaches the alert % / 100% of the daily budget (once per
 * threshold per day; when both are crossed at once, one message for the higher), and when a group's AI use
 * spikes (once per group per day). Needs BOT_OWNER_TELEGRAM_ID.
 */
export async function runAiAlerts(day: string, rows: DailyRow[], notify: OwnerNotifier): Promise<string[]> {
  const ownerId = configService.botOwnerTelegramId;
  if (!ownerId) return [];
  const sent: string[] = [];
  const global = rows.find((r) => r.groupId === null);
  const groups = rows.filter((r) => r.groupId);

  const settings = await settingsService.getAi();
  const reached = reachedThresholds(global?.aiCostUsd ?? 0, settings.dailyBudgetUsd, settings.alertAtPercent);
  if (global && reached.length && settings.dailyBudgetUsd) {
    // Claim every reached threshold; message only for the highest newly claimed one.
    let highestNew: number | null = null;
    for (const t of reached) {
      if ((await claim(`ai_budget_alert:${day}:${t}`)) && highestNew === null) highestNew = t;
    }
    if (highestNew !== null) {
      const top = [...groups].sort((a, b) => b.aiCostUsd - a.aiCostUsd).filter((r) => r.aiCostUsd > 0).slice(0, 3);
      const names = await groupNames(top.map((r) => r.groupId as string));
      const text = budgetAlertText({
        costUsd: global.aiCostUsd,
        budgetUsd: settings.dailyBudgetUsd,
        threshold: highestNew,
        calls: global.aiCalls,
        unpriced: global.aiUnpriced,
        topGroups: top.map((r) => ({ name: names[r.groupId as string] ?? 'Unknown group', costUsd: r.aiCostUsd, calls: r.aiCalls })),
        link: adminLink('/ai'),
      });
      await notify(ownerId, text);
      sent.push(text);
    }
  }

  const spikes = findSpikes(groups, await baselineCalls(day));
  if (spikes.length) {
    const names = await groupNames(spikes.map((s) => s.groupId));
    for (const spike of spikes) {
      if (!(await claim(`ai_spike_alert:${day}:${spike.groupId}`))) continue;
      const text = spikeAlertText(names[spike.groupId] ?? 'Unknown group', spike, adminLink(`/groups/${spike.groupId}`));
      await notify(ownerId, text);
      sent.push(text);
    }
  }
  return sent;
}

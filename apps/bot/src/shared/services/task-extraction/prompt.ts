import {
  EPIC_DESCRIPTION_PROMPT_MAX,
  EXTRACTION_EPICS_MAX,
  ExtractionInput,
  ExtractionMember,
} from 'src/shared/services/task-extraction/types';

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD of `date` in `timezone`. */
export function dateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateTimeLabel(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${dateInTimezone(date, timezone)} ${get('weekday')} ${get('hour')}:${get('minute')}`;
}

function memberLabel(m: ExtractionMember): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ');
  if (m.username && name) return `@${m.username} (${name})`;
  return m.username ? `@${m.username}` : name || `user ${m.telegramUserId}`;
}

export function buildExtractionPrompt(input: ExtractionInput): string {
  const tz = safeTimezone(input.timezone);
  const now = input.now ?? new Date();
  const lines: string[] = [];
  lines.push(`Group timezone: ${tz}`);
  lines.push(`Today: ${dateTimeLabel(now, tz)}`);
  lines.push('');
  lines.push('Group members:');
  if (input.members.length === 0) lines.push('- (unknown)');
  for (const m of input.members.slice(0, 200)) lines.push(`- ${memberLabel(m)}`);
  lines.push('');
  const epics = input.epics ?? [];
  if (epics.length) {
    lines.push('Open epics (groups of related tasks):');
    for (const epic of epics.slice(0, EXTRACTION_EPICS_MAX)) {
      const about = epic.description?.replace(/\s+/g, ' ').trim();
      const clipped = about && about.length > EPIC_DESCRIPTION_PROMPT_MAX ? `${about.slice(0, EPIC_DESCRIPTION_PROMPT_MAX - 1)}…` : about;
      lines.push(`- ${JSON.stringify(epic.title)}${clipped ? ` — ${clipped}` : ''}`);
    }
    lines.push('');
  }
  lines.push('Messages (oldest first):');
  for (const msg of input.messages) {
    const when = dateTimeLabel(new Date(msg.date * 1000), tz);
    lines.push(`[id ${msg.messageId}] ${msg.fromName} · ${when}:`);
    lines.push(msg.text);
    const tagged = (msg.mentions ?? []).filter((x) => x.telegramUserId).map((x) => x.text);
    if (tagged.length) lines.push(`(tagged people: ${tagged.join(', ')})`);
    lines.push('');
  }
  if (input.note) {
    lines.push(`Requester's note: ${input.note}`);
  }
  return lines.join('\n');
}

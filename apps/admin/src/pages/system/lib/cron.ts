const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

const isNum = (s: string) => /^\d+$/.test(s);
const hhmm = (h: string, m: string) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;

/** Common cron patterns in words ("Every 15 minutes", "Daily at 09:00 UTC"); null when it's something else. */
export function describeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];
  if (dom !== '*' || mon !== '*') return null;

  if (hour === '*' && dow === '*') {
    if (min === '*') return 'Every minute';
    const every = /^\*\/(\d+)$/.exec(min);
    if (every) return `Every ${every[1]} minutes`;
    if (isNum(min)) return min === '0' ? 'Every hour, on the hour' : `Every hour at :${min.padStart(2, '0')}`;
    return null;
  }
  const everyHours = /^\*\/(\d+)$/.exec(hour);
  if (everyHours && isNum(min) && dow === '*') return `Every ${everyHours[1]} hours`;
  if (!isNum(min) || !isNum(hour)) return null;
  const at = `at ${hhmm(hour, min)} UTC`;
  if (dow === '*') return `Daily ${at}`;
  if (dow === '1-5') return `Weekdays ${at}`;
  if (isNum(dow) && Number(dow) <= 7) return `${DAYS[Number(dow) % 7]} ${at}`;
  return null;
}

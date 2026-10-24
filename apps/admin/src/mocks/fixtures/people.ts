/** The people in the fixtures (by index — groups and other fixtures refer to them as `people[i]`). */
import type { AdminPersonRef } from '@tbot/shared';

import { int, oid } from './random';

export type MockPerson = AdminPersonRef & { id: string; createdDaysAgo: number };

export const people: MockPerson[] = [
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

export const personRef = (p: MockPerson): AdminPersonRef => ({
  id: p.id,
  telegramUserId: p.telegramUserId,
  name: p.name,
  username: p.username,
});

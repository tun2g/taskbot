import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let version: string | null = null;
export function adminApiVersion(): string {
  if (version) return version;
  try {
    version =
      process.env.APP_VERSION ||
      // src/modules/system/helpers → apps/admin-api (dist/modules/system/helpers in the build).
      (JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')).version as string);
  } catch {
    version = 'unknown';
  }
  return version;
}

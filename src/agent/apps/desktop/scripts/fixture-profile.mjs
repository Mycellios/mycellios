import path from 'node:path';
import {tmpdir} from 'node:os';
// Windows PostgreSQL drops administrator privileges. Hosted runner TEMP can be
// administrator-owned; use the user's directory, as the real Desktop does.
export function fixtureTempRoot() {
  return process.platform==='win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA,'Temp') : tmpdir();
}

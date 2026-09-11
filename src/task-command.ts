import { existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

export function resolveProgram(name: string): string {
  if (!name || name.includes('\0')) throw new Error('Executable is required.');
  const candidates = isAbsolute(name) || name.includes('/') || name.includes('\\')
    ? [resolve(name)]
    : name === 'node' ? [process.execPath] : (process.env.PATH ?? '').split(delimiter).flatMap(directory =>
      process.platform === 'win32' ? [join(directory, name), join(directory, `${name}.exe`)] : [join(directory, name)]);
  const found = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
  if (!found) throw new Error(`Executable not found: ${name}`);
  const actual = realpathSync(found);
  if (process.platform === 'win32' && !actual.toLowerCase().endsWith('.exe')) throw new Error('Program mode requires a native .exe on Windows; shell wrappers are not accepted.');
  return actual;
}

export function resolveCwd(input: string): string {
  if (/^(ssh|wsl):\/\//i.test(input) || /^(\\\\|\/\/)/.test(input)) throw new Error('Remote workspaces are unsupported. Run on the execution host.');
  const cwd = realpathSync(resolve(input));
  if (/^(\\\\|\/\/)/.test(cwd)) throw new Error('Remote workspaces are unsupported. Run on the execution host.');
  if (!statSync(cwd).isDirectory()) throw new Error('Working directory must be a folder.');
  return cwd;
}

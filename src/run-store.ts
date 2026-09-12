import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import type { RunState } from './run-types.js';
import { settled } from './run-types.js';

export function runPath(store: string, id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid task ID.');
  return join(resolve(store), 'runs', id);
}
export function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let retries = 0; ; retries++) {
    try { renameSync(temporary, file); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || retries === 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
      // Windows readers can briefly block replacement; never delete the old record.
      Atomics.wait(pause, 0, 0, 50);
    }
  }
}
export function readState(store: string, id: string): RunState {
  const file = join(runPath(store, id), 'state.json');
  const state = JSON.parse(readFileSync(file, 'utf8')) as RunState;
  if (state.id !== id) throw new Error('Stored task identity mismatch.');
  if (!settled(state) && (state.host !== hostname() || state.platform !== process.platform || Date.now() - Date.parse(state.updatedAt) > 10_000)) {
    return { ...state, phase: 'unverifiable', liveness: 'unverifiable', reason: 'Supervisor cannot be verified; no PID-based stop or automatic restart is allowed.' };
  }
  return state;
}
export function ensureStore(store: string): string {
  const root = resolve(store);
  mkdirSync(join(root, 'runs'), { recursive: true, mode: 0o700 });
  return root;
}
export function activeId(store: string): string | undefined {
  const file = join(resolve(store), 'active');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
}

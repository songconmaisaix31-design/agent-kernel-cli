import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { processEnvironment } from './process-environment.js';
import { activeId, ensureStore, readState, runPath, writeJson } from './run-store.js';
import { settled } from './run-types.js';
import type { RunState, TaskInput } from './run-types.js';

export async function startTask(store: string, task: TaskInput): Promise<RunState> {
  if (process.platform !== 'win32') throw new Error('Starting tasks currently requires Windows; Linux VM acceptance is pending.');
  const root = ensureStore(store);
  const id = randomUUID();
  const lock = join(root, 'active');
  try { writeFileSync(lock, id, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`A task already owns this store: ${activeId(root)}. Inspect status/result; no automatic retry or stale-lock removal.`);
    throw error;
  }
  const directory = runPath(root, id);
  let launched = false;
  try {
    mkdirSync(directory, { mode: 0o700 });
    writeJson(join(directory, 'task.json'), task);
    writeFileSync(join(directory, 'prompt.txt'), task.prompt, { mode: 0o600 });
    const now = new Date().toISOString();
    const state: RunState = {
      id, agent: task.agent, cwd: task.cwd, phase: 'starting', host: hostname(), platform: process.platform,
      createdAt: now, updatedAt: now, liveness: 'unverifiable'
    };
    writeJson(join(directory, 'state.json'), state);
    const log = openSync(join(directory, 'supervisor.log'), 'a', 0o600);
    const child = spawn(process.execPath, [fileURLToPath(new URL('./supervisor.js', import.meta.url)), root, id],
      { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: processEnvironment() });
    closeSync(log);
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => { launched = true; resolve(); });
      child.once('error', reject);
    });
    child.unref();
    return state;
  } catch (error) {
    if (!launched && activeId(root) === id) unlinkSync(lock);
    throw error;
  }
}

export async function stopTask(store: string, id: string): Promise<RunState> {
  const state = readState(store, id);
  if (state.host !== hostname() || state.platform !== process.platform) throw new Error('Stop must run on the task execution host.');
  if (settled(state) || state.phase === 'unverifiable') return state;
  const request = join(runPath(store, id), 'stop');
  try { writeFileSync(request, new Date().toISOString(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = readState(store, id);
    if (settled(current) || current.phase === 'unverifiable') return current;
    await delay(100);
  }
  return readState(store, id);
}

export function readResult(store: string, id: string) {
  const state = readState(store, id);
  const directory = runPath(store, id);
  const file = join(directory, 'result.json');
  return {
    state,
    outcome: existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null,
    files: { stdout: join(directory, 'stdout.log'), stderr: join(directory, 'stderr.log'), runner: join(directory, 'runner.jsonl') }
  };
}

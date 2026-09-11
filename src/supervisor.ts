import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { activeId, runPath, writeJson } from './run-store.js';
import type { ProcessResult, RunState, TaskInput } from './run-types.js';
import { launchWindows } from './windows-process.js';
import { readCodexResult } from './codex-command.js';

const [store, id] = process.argv.slice(2);
if (!store || !id) throw new Error('Supervisor requires a store and task ID.');
const directory = runPath(store, id);
if (activeId(store) !== id) throw new Error('Task no longer owns the store.');
const task = JSON.parse(readFileSync(join(directory, 'task.json'), 'utf8')) as TaskInput;
const state = JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')) as RunState;
state.supervisorPid = process.pid;
const persist = () => {
  state.updatedAt = new Date().toISOString();
  writeJson(join(directory, 'state.json'), state);
};
persist();
let stop: (() => void) | undefined;
let stopping = false;
const requestStop = () => {
  if (stopping) return;
  stopping = true;
  state.phase = 'stopping';
  persist();
  stop?.();
};
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
const heartbeat = setInterval(() => {
  if (existsSync(join(directory, 'stop'))) requestStop();
  persist();
}, 300);
try {
  let outcome: ProcessResult;
  if (existsSync(join(directory, 'stop'))) {
    outcome = { reason: 'stopped', exitCode: null, remaining: 0, verified: true };
  } else {
    const runner = launchWindows(task, directory, (pid) => {
      state.childPid = pid;
      state.phase = stopping ? 'stopping' : 'running';
      state.liveness = 'live';
      persist();
    });
    stop = runner.stop;
    outcome = await runner.done;
  }
  clearInterval(heartbeat);
  state.exitCode = outcome.exitCode;
  state.reason = outcome.reason;
  state.liveness = outcome.verified && outcome.remaining === 0 ? 'exited' : 'unverifiable';
  state.phase = state.liveness !== 'exited' ? 'unverifiable'
    : outcome.reason === 'stopped' ? 'stopped'
    : outcome.reason === 'timed_out' ? 'timed_out'
    : outcome.reason === 'completed' && outcome.exitCode === 0 ? 'succeeded' : 'failed';
  const stdout = join(directory, 'stdout.log');
  let text = existsSync(stdout) ? readFileSync(stdout, 'utf8').slice(0, 256_000) : '';
  let codex: ReturnType<typeof readCodexResult> | undefined;
  if (task.agent === 'codex' && state.phase === 'succeeded') {
    try { codex = readCodexResult(stdout); text = codex.text; }
    catch (error) {
      state.phase = 'failed';
      state.reason = 'codex_incomplete';
      outcome = { ...outcome, reason: state.reason, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  writeJson(join(directory, 'result.json'), { phase: state.phase, ...outcome, text, codex, finishedAt: new Date().toISOString(), agent: task.agent });
  state.result = join(directory, 'result.json');
  persist();
  if (state.liveness === 'exited' && activeId(store) === id) unlinkSync(join(store, 'active'));
} catch (error) {
  clearInterval(heartbeat);
  stop?.();
  state.phase = 'unverifiable';
  state.liveness = 'unverifiable';
  state.reason = error instanceof Error ? error.message : String(error);
  persist();
  process.exitCode = 1;
}

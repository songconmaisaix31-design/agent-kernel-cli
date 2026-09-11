import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const exec = promisify(execFile);
const cli = resolve('dist/cli.js');
const fixture = resolve('tests/fixtures/program.mjs');
const evidence = resolve('.agent-kernel-cli/tests');
mkdirSync(evidence, { recursive: true });
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
function setup() {
  const root = mkdtempSync(join(evidence, 'run-'));
  const cwd = join(root, "练习 folder & quotes ' space");
  mkdirSync(cwd);
  return { root, cwd, store: join(root, 'store') };
}
async function command(store, ...args) {
  try {
    const result = await exec(process.execPath, [cli, ...args, '--store', store], { timeout: 20_000 });
    return { code: 0, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { code: error.code, value: JSON.parse(error.stdout || error.stderr) };
  }
}
async function start(context, mode, timeout = 10_000, extras = []) {
  const result = await exec(process.execPath, [cli, 'start', '--agent', 'program', '--store', context.store,
    '--cwd', context.cwd, '--timeout-ms', String(timeout), '--prompt', 'literal stdin 中文 $() &',
    '--', process.execPath, fixture, mode, ...extras], { timeout: 10_000 });
  return JSON.parse(result.stdout);
}
async function wait(context, id, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = (await command(context.store, 'status', id)).value;
    if (predicate(state)) return state;
    await delay(100);
  }
  const result = await command(context.store, 'result', id);
  throw new Error(`Task did not settle: ${JSON.stringify(result)}`);
}
const terminal = state => ['succeeded', 'failed', 'stopped', 'timed_out', 'unverifiable'].includes(state.phase);
const windows = { skip: process.platform !== 'win32', timeout: 30_000 };

test('successful program preserves cwd, Unicode, exact argv and stdin; results survive CLI exit', windows, async () => {
  const context = setup();
  const args = ['a b', '"quoted"', 'end\\', '', '$() & ;', '中文'];
  const task = await start(context, 'success', 10_000, args);
  assert.equal(task.phase, 'starting');
  const state = await wait(context, task.id, terminal);
  assert.equal(state.phase, 'succeeded');
  assert.equal(state.liveness, 'exited');
  const result = await command(context.store, 'result', task.id);
  const output = JSON.parse(result.value.outcome.text);
  assert.deepEqual(output.args, args);
  assert.equal(output.cwd, context.cwd);
  assert.equal(output.stdin, 'literal stdin 中文 $() &');
  assert.equal(result.value.outcome.remaining, 0);
  assert.equal((await command(context.store, 'stop', task.id)).value.phase, 'succeeded');
});

test('program failure keeps exit code and stderr, with a failing result command', windows, async () => {
  const context = setup();
  const task = await start(context, 'failure');
  const state = await wait(context, task.id, terminal);
  assert.equal(state.phase, 'failed');
  assert.equal(state.exitCode, 7);
  const result = await command(context.store, 'result', task.id);
  assert.equal(result.code, 1);
  assert.match(readFileSync(result.value.files.stderr, 'utf8'), /intentional fixture failure/);
});

test('hung program has a bounded timeout and confirmed process exit', windows, async () => {
  const context = setup();
  const task = await start(context, 'hang', 600);
  const state = await wait(context, task.id, terminal);
  assert.equal(state.phase, 'timed_out');
  assert.equal(state.liveness, 'exited');
  assert.equal(alive(state.childPid), false);
});

test('stop kills the owned parent, child and grandchild; unrelated sentinel stays live', windows, async t => {
  const context = setup();
  const sentinel = spawn(process.execPath, [fixture, 'hang'], { stdio: 'ignore', windowsHide: true });
  await new Promise((done, fail) => { sentinel.once('spawn', done); sentinel.once('error', fail); });
  t.after(() => sentinel.kill());
  const task = await start(context, 'tree', 20_000);
  t.after(() => command(context.store, 'stop', task.id));
  await wait(context, task.id, state => state.phase === 'running');
  let children = [];
  for (let i = 0; i < 60; i++) {
    try { children = readFileSync(join(context.store, 'runs', task.id, 'stdout.log'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch {}
    if (children.length === 3) break;
    await delay(100);
  }
  assert.equal(children.length, 3);
  for (const child of children) assert.equal(alive(child.pid), true);
  const stopped = await command(context.store, 'stop', task.id);
  assert.equal(stopped.value.phase, 'stopped');
  for (const child of children) assert.equal(alive(child.pid), false);
  assert.equal(alive(sentinel.pid), true);
  assert.equal((await command(context.store, 'stop', task.id)).value.phase, 'stopped');
});

test('one store refuses another agent while a task owns it', windows, async t => {
  const context = setup();
  const task = await start(context, 'hang');
  t.after(() => command(context.store, 'stop', task.id));
  await assert.rejects(start(context, 'success'), /already owns this store/);
  const stopped = await command(context.store, 'stop', task.id);
  assert.equal(stopped.value.phase, 'stopped');
  const next = await start(context, 'success');
  assert.equal((await wait(context, next.id, terminal)).phase, 'succeeded');
});

test('normal parent exit also reaps a lingering descendant before success', windows, async () => {
  const context = setup();
  const task = await start(context, 'orphan');
  const state = await wait(context, task.id, terminal);
  assert.equal(state.phase, 'succeeded');
  const output = JSON.parse((await command(context.store, 'result', task.id)).value.outcome.text);
  assert.equal(alive(output.pid), false);
});

test('stale and wrong-host state never authorizes PID-based stopping', { timeout: 10_000 }, async t => {
  const context = setup();
  const sentinel = spawn(process.execPath, [fixture, 'hang'], { stdio: 'ignore', windowsHide: true });
  await new Promise((done, fail) => { sentinel.once('spawn', done); sentinel.once('error', fail); });
  t.after(() => sentinel.kill());
  const id = randomUUID();
  const directory = join(context.store, 'runs', id);
  mkdirSync(directory, { recursive: true });
  const state = { id, host: hostname(), platform: process.platform, phase: 'running', liveness: 'live', updatedAt: '2000-01-01T00:00:00Z', childPid: sentinel.pid };
  writeFileSync(join(directory, 'state.json'), JSON.stringify(state));
  assert.equal((await command(context.store, 'stop', id)).value.phase, 'unverifiable');
  assert.equal(alive(sentinel.pid), true);
  writeFileSync(join(directory, 'state.json'), JSON.stringify({ ...state, host: 'another-host' }));
  assert.match((await command(context.store, 'stop', id)).value.error, /execution host/);
});

test('invalid IDs and missing executables fail without creating an active task', async () => {
  const context = setup();
  assert.match((await command(context.store, 'result', '../../outside')).value.error, /Invalid task ID/);
  const result = await command(context.store, 'status');
  assert.equal(result.value.phase, 'idle');
});

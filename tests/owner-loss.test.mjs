import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('loss of the owning process closes the pipe and reaps the entire Job', { skip: process.platform !== 'win32', timeout: 25_000 }, async t => {
  const root = resolve('.agent-kernel-cli/tests');
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, 'owner-loss-'));
  const owner = spawn(process.execPath, [resolve('tests/fixtures/owner.mjs'), directory], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => owner.kill());
  let errors = '';
  owner.stderr.on('data', chunk => { errors += chunk; });
  let descendants = [];
  for (let i = 0; i < 100; i++) {
    try { descendants = readFileSync(join(directory, 'stdout.log'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch {}
    if (descendants.length === 3) break;
    await delay(100);
  }
  assert.equal(descendants.length, 3, errors);
  const closed = new Promise(done => owner.once('close', done));
  owner.kill();
  await closed;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  for (let i = 0; i < 100; i++) {
    if (descendants.every(child => !alive(child.pid))) break;
    await delay(100);
  }
  // The recorder died with its owner; only fresh OS exit observations are evidence here.
  for (const descendant of descendants) assert.throws(() => process.kill(descendant.pid, 0), { code: 'ESRCH' });
});

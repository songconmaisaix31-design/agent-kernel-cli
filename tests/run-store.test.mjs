import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { writeJson } from '../dist/run-store.js';

function fixture(t, platform, failures, code) {
  const root = resolve('.agent-kernel-cli/tests');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(join(root, 'state-rename-'));
  const file = join(directory, 'state.json');
  fs.writeFileSync(file, '{"phase":"running"}\n');
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
  const originalRename = fs.renameSync;
  const originalError = Object.assign(new Error('fixture rename failure'), { code });
  let calls = 0;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    calls++;
    assert.equal(fs.existsSync(destination), true, 'the original record must not be deleted');
    if (calls <= failures) throw originalError;
    return originalRename(source, destination);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    Object.defineProperty(process, 'platform', originalPlatform);
  });
  return { file, error: originalError, calls: () => calls };
}

test('Windows transient rename contention preserves the old record until atomic replacement', t => {
  const context = fixture(t, 'win32', 2, 'EPERM');
  writeJson(context.file, { phase: 'stopped' });
  assert.equal(context.calls(), 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(context.file, 'utf8')), { phase: 'stopped' });
  assert.equal(fs.existsSync(`${context.file}.${process.pid}.tmp`), false);
});

test('persistent Windows rename failure is bounded and preserves the original error and record', t => {
  const context = fixture(t, 'win32', Infinity, 'EPERM');
  assert.throws(() => writeJson(context.file, { phase: 'stopped' }), error => error === context.error);
  assert.equal(context.calls(), 6);
  assert.deepEqual(JSON.parse(fs.readFileSync(context.file, 'utf8')), { phase: 'running' });
  assert.equal(fs.existsSync(`${context.file}.${process.pid}.tmp`), true);
});

test('Windows unrelated rename errors are not retried', t => {
  const context = fixture(t, 'win32', Infinity, 'ENOSPC');
  assert.throws(() => writeJson(context.file, {}), error => error === context.error);
  assert.equal(context.calls(), 1);
});

test('POSIX rename errors retain their original behavior', t => {
  const context = fixture(t, 'linux', Infinity, 'EPERM');
  assert.throws(() => writeJson(context.file, {}), error => error === context.error);
  assert.equal(context.calls(), 1);
});

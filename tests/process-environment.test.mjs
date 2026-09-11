import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processEnvironment } from '../dist/process-environment.js';
test('child environment excludes parent authority and API billing overrides without changing the parent', () => {
  const names = ['ORCA_TEST_AUTHORITY', 'CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_API_KEY', 'OPENAI_API_KEY'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = 'fixture-not-a-credential';
    const child = processEnvironment();
    for (const name of names) {
      assert.equal(child[name], undefined);
      assert.equal(process.env[name], 'fixture-not-a-credential');
    }
    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path');
    assert.equal(child[pathKey], process.env[pathKey]);
    assert.equal(child.CODEX_HOME, process.env.CODEX_HOME);
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

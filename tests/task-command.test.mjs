import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCwd } from '../dist/task-command.js';
test('remote, WSL and UNC workspace requests fail before execution', () => {
  for (const path of ['ssh://host/repo', 'wsl://Ubuntu/repo', '\\\\host\\share', '//host/share']) {
    assert.throws(() => resolveCwd(path), /Remote workspaces/);
  }
});

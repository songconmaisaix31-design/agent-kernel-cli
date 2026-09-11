import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codexArguments, readCodexResult } from '../dist/codex-command.js';
const root = resolve('.agent-kernel-cli/tests');
mkdirSync(root, { recursive: true });
function transcript(events) {
  const file = join(mkdtempSync(join(root, 'codex-parser-')), 'events.jsonl');
  writeFileSync(file, events.map(event => typeof event === 'string' ? event : JSON.stringify(event)).join('\n'));
  return file;
}
test('Codex invocation enforces read-only execution and denies escalation', () => {
  const args = codexArguments();
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('--ask-for-approval') + 1], 'never');
  assert.ok(!args.some(arg => /bypass|ignore-rules|ignore-user-config|full-auto/.test(arg)));
});
test('Codex parser requires completion, final text and thread; failures are not success', () => {
  const good = [
    { type: 'thread.started', thread_id: 'fixture-thread' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'Parser fixture only' } },
    { type: 'turn.completed', usage: { input_tokens: 1 } }
  ];
  assert.equal(readCodexResult(transcript(good)).text, 'Parser fixture only');
  assert.throws(() => readCodexResult(transcript(good.slice(0, -1))), /did not emit/);
  assert.throws(() => readCodexResult(transcript([...good, { type: 'turn.failed' }])), /did not emit/);
  assert.throws(() => readCodexResult(transcript(['invalid JSON'])));
  assert.equal(readCodexResult(transcript([{ type: 'error', message: 'Reconnecting... 2/5' }, ...good])).warnings.length, 1);
  const blocked = [...good];
  blocked[1] = { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ error: 'ShellExecuteExW setup helper: 1223' }) } };
  assert.throws(() => readCodexResult(transcript(blocked)), /task reported failure: ShellExecuteExW/);
});
